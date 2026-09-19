'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const App = require('../src/app-v038');
const Bootstrap = require('../src/bootstrap');
const UpdateCore = require('../src/update-core-v034');
const PropertyCore = require('../src/property-core');
const MarketCore = require('../src/market-core');

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
}

function rawProperties() {
  return [
    { id: 101, property: { id: 13, name: 'Private Island' }, owner: { id: 1 }, happy: 4500, status: 'none', modifications: [] },
    { id: 102, property: { id: 10, name: 'Castle' }, owner: { id: 1 }, happy: 5000, status: 'rented', modifications: ['Hot Tub'] },
    { id: 999, property: { id: 11, name: 'Palace' }, owner: { id: 2 }, happy: 4800, status: 'none', modifications: [] }
  ];
}

function createController(storage, calls) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.torn.com/properties.php' });
  const controller = App.createController({
    window: dom.window,
    document: dom.window.document,
    storage,
    apiClient: {
      async fetchCurrentUserId() { calls.owner += 1; return 1; },
      async fetchOwnedProperties() { calls.properties += 1; return rawProperties(); },
      async scanMarkets() { calls.markets += 1; throw new Error('startup must not scan markets'); }
    },
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: { save(d) { return d; }, loadFor() { return null; }, clear() {} },
    navigate() {}
  });
  return { dom, controller };
}

test('startup property sync loads only verified owned properties and never scans rental markets', async () => {
  const calls = { owner: 0, properties: 0, markets: 0 };
  const { dom, controller } = createController(memoryStorage(), calls);

  assert.equal(typeof controller.syncOwnedProperties, 'function');
  await controller.syncOwnedProperties();

  assert.deepEqual(calls, { owner: 1, properties: 1, markets: 0 });
  assert.deepEqual(controller.getState().properties.map(property => property.id), [101, 102]);
  assert.equal(controller.getState().rows.length, 2);

  for (const id of [101, 102]) {
    const card = dom.window.document.querySelector(`[data-property-id="${id}"]`);
    assert.ok(card, `property ${id} should render after startup sync`);
    const scan = card.querySelector('[data-action="v034-update-property"]');
    assert.ok(scan, `property ${id} should have its own market scan action`);
    assert.match(scan.textContent, /SCAN MARKET/i);
  }
});

test('legacy automatic-page-update preference cannot trigger an automatic rental-market scan', async () => {
  assert.equal(typeof Bootstrap.runInitialUpdate, 'function');
  const storage = memoryStorage();
  UpdateCore.saveSettings(storage, { autoPageUpdate: true });
  const calls = { owner: 0, properties: 0, markets: 0 };
  const { controller } = createController(storage, calls);

  await controller.syncOwnedProperties();
  assert.equal(controller.getUpdateSettings().autoPageUpdate, false);
  assert.equal(await Bootstrap.runInitialUpdate(controller), false);
  assert.deepEqual(calls, { owner: 1, properties: 1, markets: 0 });
});

test('settings explain that owned properties are automatic and market scans are manual', () => {
  const calls = { owner: 0, properties: 0, markets: 0 };
  const { dom, controller } = createController(memoryStorage(), calls);
  controller.openSettings();
  const settings = dom.window.document.getElementById('r4g3-prm-settings-window');
  const note = settings && settings.querySelector('[data-role="v038-update-help"]');
  assert.ok(note);
  assert.match(note.textContent, /owned properties refresh automatically/i);
  assert.match(note.textContent, /SCAN MARKET/i);
  assert.match(note.textContent, /UPDATE ALL/i);
});
