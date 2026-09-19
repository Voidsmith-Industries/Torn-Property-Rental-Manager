(function (root, factory) {
  const baseApp = typeof module === 'object' && module.exports ? require('./app-v037') : root.R4G3PropertyRentalApp;
  const updateCore = typeof module === 'object' && module.exports ? require('./update-core-v034') : root.R4G3UpdateCoreV034;
  const api = factory(baseApp, updateCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalApp = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (baseApp, updateCore) {
  'use strict';

  if (!baseApp || !updateCore) throw new Error('v0.3.8 app dependencies are unavailable');

  function createController(options) {
    const config = options || {};
    const windowLike = config.window;
    const documentLike = config.document;
    const storage = config.storage || windowLike && windowLike.localStorage;
    if (!windowLike || !documentLike) throw new TypeError('window and document are required');

    const baseController = baseApp.createController(config);
    let syncPromise = null;
    let cachedSyncClient = null;
    let cachedSyncKey = null;
    let observer = null;
    let scheduled = false;
    let destroyed = false;

    function syncClient() {
      if (config.apiClient) return config.apiClient;
      if (typeof config.apiClientFactory !== 'function') return null;
      const settings = typeof baseController.getSettings === 'function' ? baseController.getSettings() : {};
      const key = String(settings && settings.apiKey || '').trim();
      if (!key) return null;
      if (cachedSyncClient && cachedSyncKey === key) return cachedSyncClient;
      cachedSyncClient = config.apiClientFactory(key);
      cachedSyncKey = key;
      return cachedSyncClient;
    }

    function filterPropertyMarkets(propertyMarkets, properties) {
      const source = propertyMarkets && typeof propertyMarkets === 'object' ? propertyMarkets : {};
      const ownedIds = new Set((Array.isArray(properties) ? properties : []).map(property => String(property.id)));
      const result = {};
      for (const [id, market] of Object.entries(source)) {
        if (ownedIds.has(String(id))) result[id] = market;
      }
      return result;
    }

    function savePropertySnapshot(properties, markets, propertyMarkets) {
      const previous = updateCore.loadSnapshot(storage) || {};
      const checkedAt = Date.now();
      const propertyCheckedAt = Object.assign({}, previous.propertyCheckedAt || {});
      for (const property of Array.isArray(properties) ? properties : []) {
        const id = Number(property && property.id);
        if (Number.isInteger(id) && id > 0) propertyCheckedAt[String(id)] = checkedAt;
      }
      updateCore.saveSnapshot(storage, {
        properties,
        markets: markets || {},
        propertyMarkets: propertyMarkets || {},
        updatedAt: Number(previous.updatedAt) || 0,
        propertyUpdatedAt: Object.assign({}, previous.propertyUpdatedAt || {}),
        propertyCheckedAt,
        marketCheckedAt: Object.assign({}, previous.marketCheckedAt || {})
      });
    }

    function enhanceUi() {
      scheduled = false;
      if (destroyed) return;
      const panel = documentLike.getElementById('r4g3-prm-panel');
      if (panel) {
        for (const button of panel.querySelectorAll('[data-action="v034-update-property"]')) {
          if (button.disabled) {
            if (button.textContent !== 'SCANNING…') button.textContent = 'SCANNING…';
          } else if (button.textContent !== 'SCAN MARKET') {
            button.textContent = 'SCAN MARKET';
          }
          button.title = 'Refresh this property and scan only its matching Torn rental market';
        }
        const updateAll = panel.querySelector('[data-action="v034-update-all"]');
        if (updateAll) updateAll.title = 'Deliberately scan rental markets for all owned properties';
        const empty = panel.querySelector('[data-role="v034-empty-note"]');
        const emptyText = 'Loading your owned properties automatically. Rental markets are scanned only when you choose SCAN MARKET or UPDATE ALL.';
        if (empty && empty.textContent !== emptyText) empty.textContent = emptyText;
      }

      const settings = documentLike.getElementById('r4g3-prm-settings-window');
      if (settings) {
        const updates = settings.querySelector('[data-role="v034-update-settings"]');
        if (updates) {
          const manual = updates.querySelector('[data-action="v035-update-mode-manual"]');
          const automatic = updates.querySelector('[data-action="v035-update-mode-automatic"]');
          if (manual && manual.parentElement) manual.parentElement.style.display = 'none';
          if (automatic && automatic.parentElement) automatic.parentElement.style.display = 'none';
          let note = updates.querySelector('[data-role="v038-update-help"]');
          if (!note) {
            note = documentLike.createElement('small');
            note.dataset.role = 'v038-update-help';
            note.style.opacity = '0.78';
            updates.appendChild(note);
          }
          const noteText = 'Owned properties refresh automatically when the manager opens. Rental-market scans are always manual: SCAN MARKET for one property, or UPDATE ALL for a deliberate bulk scan.';
          if (note.textContent !== noteText) note.textContent = noteText;
          for (const child of updates.querySelectorAll('small')) {
            if (child !== note) child.style.display = 'none';
          }
        }
      }
    }

    function scheduleEnhance() {
      if (scheduled || destroyed) return;
      scheduled = true;
      const schedule = typeof windowLike.queueMicrotask === 'function'
        ? windowLike.queueMicrotask.bind(windowLike)
        : callback => Promise.resolve().then(callback);
      schedule(enhanceUi);
    }

    if (typeof windowLike.MutationObserver === 'function' && (documentLike.body || documentLike.documentElement)) {
      observer = new windowLike.MutationObserver(() => scheduleEnhance());
      observer.observe(documentLike.body || documentLike.documentElement, { childList: true, subtree: true });
    }

    async function performPropertySync() {
      const client = syncClient();
      if (!client) {
        if (typeof baseController.openSettings === 'function') baseController.openSettings();
        enhanceUi();
        return baseController.getState();
      }
      if (typeof client.fetchOwnedProperties !== 'function') throw new TypeError('API client cannot load owned properties');

      const currentUserId = typeof client.fetchCurrentUserId === 'function'
        ? await client.fetchCurrentUserId()
        : null;
      const rawProperties = await client.fetchOwnedProperties();
      const properties = config.propertyCore.normalizeProperties(rawProperties, currentUserId);
      const previousState = baseController.getState();
      const markets = Object.assign({}, previousState && previousState.markets || {});
      const propertyMarkets = filterPropertyMarkets(previousState && previousState.propertyMarkets, properties);

      if (typeof baseController.hydrate !== 'function') throw new Error('Property hydration support is unavailable');
      baseController.hydrate({ properties, markets, propertyMarkets });
      baseController.render();
      savePropertySnapshot(properties, markets, propertyMarkets);
      enhanceUi();
      return baseController.getState();
    }

    function syncOwnedProperties() {
      if (syncPromise) return syncPromise;
      syncPromise = performPropertySync().finally(() => {
        syncPromise = null;
        enhanceUi();
      });
      return syncPromise;
    }

    function wrapAsync(method, args) {
      return Promise.resolve(baseController[method](...args)).finally(enhanceUi);
    }

    const controller = Object.assign({}, baseController, {
      load: syncOwnedProperties,
      syncOwnedProperties,
      updateProperty(...args) { return wrapAsync('updateProperty', args); },
      updateAll(...args) { return wrapAsync('updateAll', args); },
      render() {
        const result = baseController.render();
        enhanceUi();
        return result;
      },
      open() {
        const result = baseController.open();
        enhanceUi();
        syncOwnedProperties().catch(() => {});
        return result;
      },
      openSettings() {
        const result = baseController.openSettings();
        enhanceUi();
        return result;
      },
      getUpdateSettings() {
        const existing = typeof baseController.getUpdateSettings === 'function'
          ? baseController.getUpdateSettings()
          : {};
        return Object.assign({}, existing || {}, { autoPageUpdate: false });
      },
      destroy() {
        destroyed = true;
        if (observer) observer.disconnect();
        observer = null;
        return baseController.destroy();
      }
    });

    enhanceUi();
    Promise.resolve().then(() => syncOwnedProperties()).catch(() => {});
    return Object.freeze(controller);
  }

  return Object.freeze(Object.assign({}, baseApp, { createController }));
}));
