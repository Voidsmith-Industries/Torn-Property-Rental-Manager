'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const portfolio = require('../src/portfolio-core');
const backup = require('../src/backup-core');
const portfolioUi = require('../src/portfolio-ui');
const propertyCore = require('../src/property-core');
const marketCore = require('../src/market-core');
const appRuntime = require('../src/app-runtime');
const build = require('../scripts/build-userscript');

function storage() {
  const map = new Map();
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value))
  };
}

function quote() {
  return {
    targetDays: 100,
    exactMatchCount: 4,
    usedMatchCount: 4,
    outlierCount: 0,
    sampleStatus: 'ok',
    proposedTotal: 248750000,
    trustedMatches: [
      { equivalentTotal: 200000000 },
      { equivalentTotal: 240000000 },
      { equivalentTotal: 260000000 },
      { equivalentTotal: 300000000 }
    ]
  };
}

test('v1 build includes landlord modules and exact runtime identity', () => {
  assert.ok(build.sourceFiles.includes('src/portfolio-core.js'));
  assert.ok(build.sourceFiles.includes('src/backup-core.js'));
  assert.ok(build.sourceFiles.includes('src/portfolio-ui.js'));
  assert.equal(appRuntime.RUNTIME_VERSION, '1.0.1');
});

test('v1 portfolio UI renders attention/search/lease/market context without submitting Torn actions', () => {
  const dom = new JSDOM('<!doctype html><body><aside id="r4g3-prm-panel"><div class="r4g3-prm-header"></div><section class="r4g3-prm-property" data-property-id="7"></section></aside><aside id="r4g3-prm-settings-window"></aside></body>', {
    url: 'https://www.torn.com/properties.php'
  });
  const store = storage();
  const state = {
    properties: [{
      id: 7,
      propertyTypeId: 13,
      name: 'Private Island',
      status: 'rented',
      rentalPeriodRemaining: 5,
      rentedBy: { id: 42, name: 'Alice' },
      costPerDay: 2000000,
      rentalPeriod: 30,
      leaseExtension: null
    }],
    rows: [{ property: { id: 7 }, quote: quote() }]
  };
  const base = {
    getState: () => state,
    getSettings: () => ({ uiState: 'open' }),
    render: () => state,
    open: () => true,
    openSettings: () => true,
    destroy: () => true
  };
  const controller = portfolioUi.create({
    baseController: base,
    window: dom.window,
    document: dom.window.document,
    storage: store,
    portfolioCore: portfolio,
    backupCore: backup,
    propertyCore
  });

  const panel = dom.window.document.getElementById('r4g3-prm-panel');
  assert.ok(panel.querySelector('#r4g3-prm-v1-dashboard'));
  assert.match(panel.textContent, /Needs attention 1/);
  assert.match(panel.textContent, /Alice/);
  assert.match(panel.textContent, /Market distribution/);
  assert.equal(panel.querySelector('button').textContent, 'OPEN EXTENSION');
  assert.ok(dom.window.document.querySelector('[data-role="backup-controls"]'));
  assert.equal(typeof controller.importBackupText, 'function');
  controller.destroy();
});


test('v1 visible Refresh performs property-only sync and never starts rental-market scans', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.torn.com/properties.php'
  });
  const calls = { owner: 0, properties: 0, markets: 0 };
  const rawProperties = [{
    id: 101,
    property: { id: 13, name: 'Private Island' },
    owner: { id: 1 },
    happy: 4500,
    status: 'none',
    modifications: []
  }];

  const controller = appRuntime.createController({
    window: dom.window,
    document: dom.window.document,
    storage: storage(),
    apiClient: {
      async fetchCurrentUserId() { calls.owner += 1; return 1; },
      async fetchOwnedProperties() { calls.properties += 1; return rawProperties; },
      async scanMarkets() { calls.markets += 1; throw new Error('Refresh must not scan rental markets'); }
    },
    propertyCore,
    marketCore,
    draftStore: { save(value) { return value; }, loadFor() { return null; }, clear() {} },
    navigate() {}
  });

  await new Promise(resolve => dom.window.setTimeout(resolve, 20));
  const before = Object.assign({}, calls);
  assert.ok(before.properties >= 1);
  assert.equal(before.markets, 0);

  const refresh = dom.window.document.querySelector('[data-action="refresh"]');
  assert.ok(refresh);
  assert.match(refresh.title, /property and lease state only/i);
  refresh.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  await new Promise(resolve => dom.window.setTimeout(resolve, 20));
  assert.equal(calls.properties, before.properties + 1);
  assert.equal(calls.owner, before.owner + 1);
  assert.equal(calls.markets, 0);

  const currentRefresh = dom.window.document.querySelector('[data-action="refresh"]');
  assert.ok(currentRefresh);
  assert.equal(currentRefresh.disabled, false);
  assert.equal(currentRefresh.textContent, 'Refresh');
  controller.destroy();
});


test('extension helper points only to Torn native extension page', () => {
  assert.equal(
    propertyCore.extensionUrl(123),
    'https://www.torn.com/properties.php#/p=options&ID=123&tab=offerExtension'
  );
  assert.throws(() => propertyCore.extensionUrl(0), /positive property ID/);
});
