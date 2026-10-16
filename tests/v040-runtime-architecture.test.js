'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const build = require('../scripts/build-userscript');

function optionalRequire(path) {
  try { return require(path); } catch (error) { return null; }
}

const UiObserver = optionalRequire('../src/ui-observer');
const AppRuntime = optionalRequire('../src/app-runtime');
const LegacyApp = require('../src/app-v0310');
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

function rawProperty(id = 101) {
  return {
    id,
    owner: { id: 1 },
    property: { id: 1, name: 'Apartment', happy: 100 },
    happy: 100,
    status: 'none',
    modifications: []
  };
}

function draftStore() {
  return {
    save() { return true; },
    loadFor() { return null; },
    clear() { return true; }
  };
}

test('v0.4.0 build ships stable app runtime modules instead of versioned app files', () => {
  assert.ok(build.sourceFiles.includes('src/ui-observer.js'));
  assert.ok(build.sourceFiles.includes('src/app-runtime.js'));
  assert.equal(build.sourceFiles.includes('src/app.js'), false);
  assert.equal(build.sourceFiles.some(file => /^src\/app-v\d+\.js$/.test(file)), false);
});

test('stable app runtime exposes the same public controller surface as v0.3.10', () => {
  assert.ok(AppRuntime, 'stable app-runtime should exist');
  assert.equal(typeof AppRuntime.createController, 'function');
  for (const key of Object.keys(LegacyApp)) {
    assert.ok(Object.prototype.hasOwnProperty.call(AppRuntime, key), `missing legacy export ${key}`);
  }
});

test('UI observer multiplexer gives app layers one native MutationObserver', () => {
  assert.ok(UiObserver, 'ui-observer should exist');
  let nativeConstructors = 0;
  let nativeCallback = null;
  let observeCalls = 0;
  let disconnectCalls = 0;

  class NativeMutationObserver {
    constructor(callback) {
      nativeConstructors += 1;
      nativeCallback = callback;
    }
    observe() { observeCalls += 1; }
    disconnect() { disconnectCalls += 1; }
    takeRecords() { return []; }
  }

  const root = {
    contains(node) { return node === this || node && node.parent === this; }
  };
  const documentLike = { documentElement: root, body: root };
  const windowLike = { MutationObserver: NativeMutationObserver };
  const AppMutationObserver = UiObserver.createWindowProxy(windowLike, documentLike).MutationObserver;
  const calls = [];
  const first = new AppMutationObserver(records => calls.push(['first', records.length]));
  const second = new AppMutationObserver(records => calls.push(['second', records.length]));

  first.observe(root, { childList: true, subtree: true });
  second.observe(root, { childList: true, subtree: true });
  assert.equal(nativeConstructors, 1, 'all app observers should share one native observer');
  assert.ok(observeCalls >= 1);

  nativeCallback([{ type: 'childList', target: root, addedNodes: [], removedNodes: [] }]);
  assert.deepEqual(calls, [['first', 1], ['second', 1]]);

  first.disconnect();
  second.disconnect();
  assert.ok(disconnectCalls >= 1);
});

test('UI observer multiplexer never narrows an observer that requested all attributes', () => {
  assert.ok(UiObserver, 'ui-observer should exist');
  const observedOptions = [];

  class NativeMutationObserver {
    constructor() {}
    observe(target, options) { observedOptions.push(Object.assign({}, options)); }
    disconnect() {}
    takeRecords() { return []; }
  }

  const root = { contains() { return true; } };
  const documentLike = { documentElement: root, body: root };
  const windowLike = { MutationObserver: NativeMutationObserver };
  const Observer = UiObserver.createWindowProxy(windowLike, documentLike).MutationObserver;
  const allAttributes = new Observer(() => {});
  const filteredAttributes = new Observer(() => {});

  allAttributes.observe(root, { attributes: true, subtree: true });
  filteredAttributes.observe(root, { attributes: true, subtree: true, attributeFilter: ['class'] });

  const finalOptions = observedOptions[observedOptions.length - 1];
  assert.equal(finalOptions.attributes, true);
  assert.equal(Object.prototype.hasOwnProperty.call(finalOptions, 'attributeFilter'), false,
    'one unfiltered virtual observer requires the native observer to receive every attribute');

  allAttributes.disconnect();
  filteredAttributes.disconnect();
});

test('stable v0.4.0 runtime boots the real controller stack with one app-level native observer', async () => {
  assert.ok(AppRuntime, 'stable app-runtime should exist');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.torn.com/properties.php' });
  const RealMutationObserver = dom.window.MutationObserver;
  let nativeConstructors = 0;

  dom.window.MutationObserver = class CountingMutationObserver {
    constructor(callback) {
      nativeConstructors += 1;
      this.inner = new RealMutationObserver(callback);
    }
    observe(target, options) { return this.inner.observe(target, options); }
    disconnect() { return this.inner.disconnect(); }
    takeRecords() { return this.inner.takeRecords(); }
  };

  const apiClient = {
    async fetchCurrentUserId() { return 1; },
    async fetchOwnedProperties() { return [rawProperty()]; },
    async scanMarkets() { return {}; }
  };

  const controller = AppRuntime.createController({
    window: dom.window,
    document: dom.window.document,
    storage: memoryStorage(),
    apiClient,
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: draftStore()
  });

  await controller.syncOwnedProperties();
  const state = controller.getState();
  assert.deepEqual(state.properties.map(property => property.id), [101]);
  assert.ok(dom.window.document.getElementById('r4g3-prm-panel'));
  assert.equal(nativeConstructors, 1, 'legacy UI layers must be multiplexed through one app-level native observer');

  controller.destroy();
  dom.window.close();
});

test('shipped runtime ignores unrelated Torn mutation storms without redundant panel scans', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.torn.com/properties.php' });
  const controller = AppRuntime.createController({
    window: dom.window,
    document: dom.window.document,
    storage: memoryStorage(),
    apiClient: {
      async fetchCurrentUserId() { return 1; },
      async fetchOwnedProperties() { return [rawProperty()]; },
      async scanMarkets() { return {}; }
    },
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: draftStore()
  });
  try {
    await controller.syncOwnedProperties();
    const panel = dom.window.document.getElementById('r4g3-prm-panel');
    assert.ok(panel);
    await new Promise(resolve => setTimeout(resolve, 0));

    let scans = 0;
    const originalQuery = panel.querySelectorAll.bind(panel);
    panel.querySelectorAll = (...args) => {
      scans += 1;
      return originalQuery(...args);
    };
    for (let i = 0; i < 150; i += 1) {
      const div = dom.window.document.createElement('div');
      div.textContent = 'unrelated Torn update ' + i;
      dom.window.document.body.appendChild(div);
    }
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(scans <= 1, 'shipped runtime must not repeatedly scan panels for unrelated DOM updates: ' + scans);
  } finally {
    controller.destroy();
    dom.window.close();
  }
});
