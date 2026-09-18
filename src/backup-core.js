(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3BackupCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA = 'voidsmith-torn-property-rental-manager-backup';
  const VERSION = 1;
  const APP_SETTINGS_KEY = 'r4g3_property_rental_manager.settings';
  const DISPLAY_SETTINGS_KEY = 'r4g3_property_rental_manager.v033';
  const UPDATE_SETTINGS_KEY = 'r4g3_property_rental_manager.v034.updates';
  const HISTORY_KEY = 'r4g3_property_rental_manager.v1.lease_history';
  const SAFE_KEYS = Object.freeze([APP_SETTINGS_KEY, DISPLAY_SETTINGS_KEY, UPDATE_SETTINGS_KEY, HISTORY_KEY]);

  function parseObject(raw) {
    if (!raw) return null;
    try {
      const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch (error) {
      return null;
    }
  }

  function sanitizeAppSettings(value) {
    const source = parseObject(value) || {};
    const safe = Object.assign({}, source);
    delete safe.apiKey;
    return safe;
  }

  function createBackup(storage, nowValue) {
    const data = {};
    if (storage && typeof storage.getItem === 'function') {
      for (const key of SAFE_KEYS) {
        const raw = storage.getItem(key);
        if (!raw) continue;
        const parsed = parseObject(raw);
        if (!parsed) continue;
        data[key] = key === APP_SETTINGS_KEY ? sanitizeAppSettings(parsed) : parsed;
      }
    }
    return {
      schema: SCHEMA,
      version: VERSION,
      exportedAt: Number.isFinite(Number(nowValue)) ? Math.floor(Number(nowValue)) : Date.now(),
      containsApiKey: false,
      data
    };
  }

  function serializeBackup(storage, nowValue) {
    return JSON.stringify(createBackup(storage, nowValue), null, 2);
  }

  function validateBackup(value) {
    const source = typeof value === 'string' ? parseObject(value) : value;
    if (!source || source.schema !== SCHEMA || Number(source.version) !== VERSION) {
      return { valid: false, reason: 'Unsupported Property Rental Manager backup' };
    }
    if (!source.data || typeof source.data !== 'object' || Array.isArray(source.data)) {
      return { valid: false, reason: 'Backup data is missing' };
    }
    const data = {};
    for (const key of SAFE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(source.data, key)) continue;
      const parsed = parseObject(source.data[key]);
      if (!parsed) return { valid: false, reason: `Invalid backup entry: ${key}` };
      data[key] = key === APP_SETTINGS_KEY ? sanitizeAppSettings(parsed) : parsed;
    }
    return { valid: true, value: { schema: SCHEMA, version: VERSION, data } };
  }

  function restoreBackup(storage, value) {
    const checked = validateBackup(value);
    if (!checked.valid) return checked;
    if (!storage || typeof storage.setItem !== 'function') return { valid: false, reason: 'Browser storage unavailable' };

    const restored = [];
    for (const [key, incoming] of Object.entries(checked.value.data)) {
      if (!SAFE_KEYS.includes(key)) continue;
      let valueToSave = incoming;
      if (key === APP_SETTINGS_KEY) {
        const current = parseObject(storage.getItem(key)) || {};
        valueToSave = Object.assign({}, current, sanitizeAppSettings(incoming));
        if (typeof current.apiKey === 'string' && current.apiKey) valueToSave.apiKey = current.apiKey;
        else delete valueToSave.apiKey;
      }
      storage.setItem(key, JSON.stringify(valueToSave));
      restored.push(key);
    }
    return { valid: true, restored, apiKeyPreserved: true };
  }

  return Object.freeze({
    SCHEMA,
    VERSION,
    APP_SETTINGS_KEY,
    DISPLAY_SETTINGS_KEY,
    UPDATE_SETTINGS_KEY,
    HISTORY_KEY,
    SAFE_KEYS,
    sanitizeAppSettings,
    createBackup,
    serializeBackup,
    validateBackup,
    restoreBackup
  });
}));