'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const backup = require('../src/backup-core');

function storage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value))
  };
}

test('v1 local backup excludes the API key and disposable market cache', () => {
  const store = storage({
    [backup.APP_SETTINGS_KEY]: JSON.stringify({ apiKey: 'SECRET', theme: 'dark', geometry: { left: 1 } }),
    [backup.DISPLAY_SETTINGS_KEY]: JSON.stringify({ pricingBasis: 'average' }),
    'r4g3_property_rental_manager.market.13': JSON.stringify({ disposable: true })
  });
  const payload = backup.createBackup(store, 123);
  assert.equal(payload.containsApiKey, false);
  assert.equal(payload.data[backup.APP_SETTINGS_KEY].apiKey, undefined);
  assert.equal(payload.data['r4g3_property_rental_manager.market.13'], undefined);
});

test('v1 restore preserves the current API key and rejects unsupported backup formats', () => {
  const store = storage({
    [backup.APP_SETTINGS_KEY]: JSON.stringify({ apiKey: 'KEEP', theme: 'dark' })
  });
  const payload = {
    schema: backup.SCHEMA,
    version: 1,
    data: {
      [backup.APP_SETTINGS_KEY]: { apiKey: 'INCOMING', theme: 'light' },
      [backup.HISTORY_KEY]: { version: 1, properties: {} }
    }
  };
  const result = backup.restoreBackup(store, payload);
  assert.equal(result.valid, true);
  const restored = JSON.parse(store.getItem(backup.APP_SETTINGS_KEY));
  assert.equal(restored.apiKey, 'KEEP');
  assert.equal(restored.theme, 'light');
  assert.equal(backup.restoreBackup(store, { schema: 'wrong', version: 1, data: {} }).valid, false);
});
