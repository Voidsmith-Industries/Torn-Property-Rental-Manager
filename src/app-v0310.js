(function (root, factory) {
  const baseApp = typeof module === 'object' && module.exports ? require('./app-v039') : root.R4G3PropertyRentalApp;
  const updateCore = typeof module === 'object' && module.exports ? require('./update-core-v034') : root.R4G3UpdateCoreV034;
  const api = factory(baseApp, updateCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalApp = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (baseApp, updateCore) {
  'use strict';

  if (!baseApp || !updateCore) throw new Error('v0.3.10 app dependencies are unavailable');

  function timestampMap(value) {
    const source = value && typeof value === 'object' ? value : {};
    return Object.assign({}, source);
  }

  function mergeTimestampMaps(a, b) {
    const result = {};
    for (const source of [a, b]) {
      for (const [key, raw] of Object.entries(source && typeof source === 'object' ? source : {})) {
        const value = Number(raw) || 0;
        if (value > Number(result[key] || 0)) result[key] = value;
      }
    }
    return result;
  }

  function isAbortError(error) {
    return Boolean(error && error.name === 'AbortError');
  }

  function requestStatusText(entry) {
    const source = entry && typeof entry === 'object' ? entry : {};
    const message = String(source.message || '').trim();
    if (message) return message;
    if (source.type === 'cooldown') return 'Torn rate limit detected; cooling down before retry.';
    if (source.type === 'retry') return `Torn request failed; retrying attempt ${Number(source.attempt) || 1}.`;
    return 'Torn request is being retried.';
  }

  function createController(options) {
    const config = Object.assign({}, options || {});
    const windowLike = config.window;
    const documentLike = config.document;
    const storage = config.storage || windowLike && windowLike.localStorage;
    if (!windowLike || !documentLike) throw new TypeError('window and document are required');

    const activeScans = new Map();
    let destroyed = false;
    let observer = null;
    let scheduled = false;
    let lastUpdate = null;
    let actionMessage = null;

    function wrapClient(client) {
      if (!client || typeof client.scanMarkets !== 'function') return client;
      return Object.assign({}, client, {
        scanMarkets(properties, options) {
          const scanOptions = Object.assign({}, options || {});
          const source = Array.isArray(properties) ? properties : [];
          const propertyId = source.length === 1 ? Number(source[0] && source[0].id) : 0;
          const active = propertyId > 0 ? activeScans.get(propertyId) : null;
          const originalRequestStatus = typeof scanOptions.onRequestStatus === 'function'
            ? scanOptions.onRequestStatus
            : null;
          if (active) {
            active.propertyChecked = true;
            if (active.controller && active.controller.signal) scanOptions.signal = active.controller.signal;
            scanOptions.onRequestStatus = entry => {
              if (originalRequestStatus) originalRequestStatus(entry);
              active.requestStatus = {
                type: String(entry && entry.type || ''),
                message: requestStatusText(entry),
                status: Number(entry && entry.status) || 0,
                attempt: Number(entry && entry.attempt) || 0,
                delayMs: Number(entry && entry.delayMs) || 0
              };
              enhanceUi();
            };
          }
          return client.scanMarkets(properties, scanOptions);
        }
      });
    }

    if (config.apiClient) config.apiClient = wrapClient(config.apiClient);
    if (typeof config.apiClientFactory === 'function') {
      const factory = config.apiClientFactory;
      config.apiClientFactory = apiKey => wrapClient(factory(apiKey));
    }

    const baseController = baseApp.createController(config);
    const initialSnapshot = updateCore.loadSnapshot(storage) || {};
    let propertyCheckedAt = timestampMap(initialSnapshot.propertyCheckedAt);
    let marketCheckedAt = timestampMap(initialSnapshot.marketCheckedAt);

    function refreshTimestampMaps() {
      const snapshot = updateCore.loadSnapshot(storage);
      if (!snapshot) return;
      propertyCheckedAt = mergeTimestampMaps(propertyCheckedAt, snapshot.propertyCheckedAt);
      marketCheckedAt = mergeTimestampMaps(marketCheckedAt, snapshot.marketCheckedAt);
    }

    function formattedTime(map, propertyId) {
      const value = Number(map[String(propertyId)] || map[propertyId] || 0);
      if (!value) return 'Never';
      try {
        return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch (error) {
        return new Date(value).toLocaleTimeString();
      }
    }

    function stateWithMeta() {
      const state = baseController.getState();
      return Object.assign({}, state, {
        actionMessage: actionMessage == null ? state.actionMessage : actionMessage,
        lastUpdate: lastUpdate ? Object.assign({}, lastUpdate) : null
      });
    }

    function saveSnapshot() {
      const state = baseController.getState();
      const previous = updateCore.loadSnapshot(storage) || {};
      return updateCore.saveSnapshot(storage, {
        properties: state.properties || [],
        markets: state.markets || {},
        propertyMarkets: state.propertyMarkets || {},
        updatedAt: Number(previous.updatedAt) || 0,
        propertyUpdatedAt: Object.assign({}, previous.propertyUpdatedAt || {}),
        propertyCheckedAt,
        marketCheckedAt
      });
    }

    function ensureCardMeta(row, propertyId) {
      const controls = row && row.querySelector && row.querySelector('[data-role="v034-card-controls"]');
      if (!controls) return;

      const id = Number(propertyId);
      const scanButton = controls.querySelector('[data-action="v034-update-property"]');
      if (scanButton && scanButton.dataset.v0310Bound !== '1') {
        scanButton.dataset.v0310Bound = '1';
        scanButton.addEventListener('click', event => {
          if (event && typeof event.preventDefault === 'function') event.preventDefault();
          if (event && typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
          else if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
          if (!activeScans.has(id)) updateProperty(id).catch(() => {});
        }, true);
      }

      let updated = controls.querySelector('[data-role="v034-last-updated"]');
      if (!updated) {
        updated = documentLike.createElement('small');
        updated.dataset.role = 'v034-last-updated';
        updated.style.opacity = '0.72';
        updated.style.marginRight = 'auto';
        controls.prepend(updated);
      }
      const updatedText = `Property checked: ${formattedTime(propertyCheckedAt, propertyId)} · Market checked: ${formattedTime(marketCheckedAt, propertyId)}`;
      if (updated.textContent !== updatedText) updated.textContent = updatedText;

      const active = activeScans.get(id);
      if (scanButton) {
        scanButton.disabled = Boolean(active);
        const label = active ? 'SCANNING…' : 'SCAN MARKET';
        if (scanButton.textContent !== label) scanButton.textContent = label;
        scanButton.title = active
          ? 'Rental-market scan in progress'
          : 'Refresh this property and scan only its matching Torn rental market';
      }

      let cancel = controls.querySelector('[data-action="v0310-cancel-scan"]');
      let requestStatus = controls.querySelector('[data-role="v0310-request-status"]');
      if (!active) {
        if (cancel && cancel.parentNode) cancel.remove();
        if (requestStatus && requestStatus.parentNode) requestStatus.remove();
        return;
      }
      if (!cancel) {
        cancel = documentLike.createElement('button');
        cancel.type = 'button';
        cancel.dataset.action = 'v0310-cancel-scan';
        cancel.dataset.propertyId = String(propertyId);
        cancel.dataset.noDrag = 'true';
        cancel.textContent = 'CANCEL SCAN';
        cancel.style.cursor = 'pointer';
        cancel.style.padding = '7px 10px';
        cancel.style.borderRadius = '7px';
        cancel.style.border = '1px solid currentColor';
        cancel.style.background = 'transparent';
        cancel.style.color = 'inherit';
        cancel.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          const current = activeScans.get(Number(propertyId));
          if (current && current.controller && !current.controller.signal.aborted) current.controller.abort();
        });
        controls.appendChild(cancel);
      }

      if (active.requestStatus) {
        if (!requestStatus) {
          requestStatus = documentLike.createElement('small');
          requestStatus.dataset.role = 'v0310-request-status';
          requestStatus.style.flexBasis = '100%';
          requestStatus.style.fontWeight = '700';
          requestStatus.style.opacity = '0.9';
          controls.appendChild(requestStatus);
        }
        const text = active.requestStatus.message || requestStatusText(active.requestStatus);
        if (requestStatus.textContent !== text) requestStatus.textContent = text;
      } else if (requestStatus && requestStatus.parentNode) {
        requestStatus.remove();
      }
    }

    function ensureActionNote(row, propertyId) {
      let note = row.querySelector('[data-role="v0310-action-note"]');
      const applies = lastUpdate && Number(lastUpdate.propertyId) === Number(propertyId) && actionMessage;
      if (!applies) {
        if (note && note.parentNode) note.remove();
        return;
      }
      if (!note) {
        note = documentLike.createElement('div');
        note.dataset.role = 'v0310-action-note';
        note.style.gridColumn = '1 / -1';
        note.style.padding = '7px 9px';
        note.style.border = '1px solid rgba(128,128,128,0.25)';
        note.style.borderRadius = '7px';
        note.style.fontWeight = lastUpdate.marketError ? '700' : '500';
        const controls = row.querySelector('[data-role="v034-card-controls"]');
        if (controls && controls.parentNode === row) row.insertBefore(note, controls);
        else row.appendChild(note);
      }
      if (note.textContent !== actionMessage) note.textContent = actionMessage;
    }

    function enhanceUi() {
      scheduled = false;
      if (destroyed) return null;
      refreshTimestampMaps();
      const panel = documentLike.getElementById('r4g3-prm-panel');
      if (!panel) return null;
      for (const row of panel.querySelectorAll('[data-property-id]')) {
        const id = Number(row.getAttribute('data-property-id'));
        if (!id) continue;
        ensureCardMeta(row, id);
        ensureActionNote(row, id);
      }
      return panel;
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

    function restorePropertyMarket(propertyId, previousState, currentState) {
      const id = String(propertyId);
      const previousMarkets = previousState && previousState.propertyMarkets || {};
      const restored = Object.assign({}, currentState && currentState.propertyMarkets || {});
      if (Object.prototype.hasOwnProperty.call(previousMarkets, id)) restored[id] = previousMarkets[id];
      else if (Object.prototype.hasOwnProperty.call(previousMarkets, Number(propertyId))) restored[id] = previousMarkets[Number(propertyId)];
      else delete restored[id];
      baseController.hydrate({
        properties: currentState && currentState.properties || [],
        markets: currentState && currentState.markets || {},
        propertyMarkets: restored
      });
      return baseController.getState();
    }

    async function updateProperty(propertyId, options) {
      const id = Number(propertyId);
      if (!Number.isInteger(id) || id <= 0) throw new TypeError('A positive property ID is required');
      if (activeScans.has(id)) return false;

      const AbortControllerCtor = windowLike.AbortController || (typeof AbortController !== 'undefined' ? AbortController : null);
      const controller = AbortControllerCtor ? new AbortControllerCtor() : null;
      const active = { controller, propertyChecked: false, requestStatus: null };
      activeScans.set(id, active);
      const previousState = baseController.getState();
      actionMessage = null;
      lastUpdate = null;

      try {
        const pending = baseController.updateProperty(id, options || {});
        enhanceUi();
        const result = await pending;
        const selectedMarket = result && result.propertyMarkets && (
          result.propertyMarkets[String(id)] || result.propertyMarkets[id]
        );
        const checkedAt = Date.now();
        if (active.propertyChecked) propertyCheckedAt[String(id)] = checkedAt;

        if (selectedMarket && selectedMarket.error) {
          const restoredState = restorePropertyMarket(id, previousState, result);
          lastUpdate = {
            propertyId: id,
            propertyChecked: active.propertyChecked,
            marketChecked: false,
            marketError: String(selectedMarket.error),
            marketUnchanged: false,
            cancelled: false
          };
          actionMessage = `Property ${id} checked; market scan failed: ${selectedMarket.error}`;
          saveSnapshot();
          enhanceUi();
          return Object.assign({}, restoredState, {
            actionMessage,
            lastUpdate: Object.assign({}, lastUpdate)
          });
        }

        marketCheckedAt[String(id)] = checkedAt;
        lastUpdate = {
          propertyId: id,
          propertyChecked: active.propertyChecked,
          marketChecked: true,
          marketError: '',
          marketUnchanged: Boolean(selectedMarket && selectedMarket.unchanged),
          cancelled: false
        };
        actionMessage = lastUpdate.marketUnchanged
          ? `Property ${id} checked; rental market unchanged.`
          : `Property ${id} and rental market updated.`;
        saveSnapshot();
        enhanceUi();
        return stateWithMeta();
      } catch (error) {
        if (isAbortError(error) || controller && controller.signal.aborted) {
          const checkedAt = Date.now();
          if (active.propertyChecked) propertyCheckedAt[String(id)] = checkedAt;
          lastUpdate = {
            propertyId: id,
            propertyChecked: active.propertyChecked,
            marketChecked: false,
            marketError: '',
            marketUnchanged: false,
            cancelled: true
          };
          actionMessage = `Market scan cancelled for property ${id}.`;
          saveSnapshot();
          return false;
        }
        lastUpdate = {
          propertyId: id,
          propertyChecked: active.propertyChecked,
          marketChecked: false,
          marketError: String(error && error.message || error),
          marketUnchanged: false,
          cancelled: false
        };
        actionMessage = active.propertyChecked
          ? `Property ${id} checked; market scan failed: ${lastUpdate.marketError}`
          : `Property ${id} check failed: ${lastUpdate.marketError}`;
        if (active.propertyChecked) {
          propertyCheckedAt[String(id)] = Date.now();
          saveSnapshot();
        }
        throw error;
      } finally {
        activeScans.delete(id);
        enhanceUi();
      }
    }

    async function updateAll(...args) {
      actionMessage = null;
      lastUpdate = null;
      const result = await baseController.updateAll(...args);
      const checkedAt = Date.now();
      for (const property of result && result.properties || []) {
        const id = Number(property && property.id);
        if (!id) continue;
        propertyCheckedAt[String(id)] = checkedAt;
        const market = result.markets && result.markets[property.propertyTypeId];
        if (market && !market.error) marketCheckedAt[String(id)] = checkedAt;
      }
      saveSnapshot();
      enhanceUi();
      return stateWithMeta();
    }

    function wrapSync(method, args) {
      const result = baseController[method](...args);
      enhanceUi();
      return result;
    }

    async function wrapAsync(method, args) {
      const result = await baseController[method](...args);
      enhanceUi();
      return result;
    }

    const controller = Object.assign({}, baseController, {
      updateProperty,
      updateAll,
      hydrate(...args) { return wrapSync('hydrate', args); },
      render(...args) { return wrapSync('render', args); },
      open(...args) { return wrapSync('open', args); },
      openSettings(...args) { return wrapSync('openSettings', args); },
      syncOwnedProperties: typeof baseController.syncOwnedProperties === 'function'
        ? (...args) => wrapAsync('syncOwnedProperties', args)
        : undefined,
      getState: stateWithMeta,
      cancelScan(propertyId) {
        const active = activeScans.get(Number(propertyId));
        if (!active || !active.controller || active.controller.signal.aborted) return false;
        active.controller.abort();
        return true;
      },
      destroy() {
        destroyed = true;
        for (const active of activeScans.values()) {
          if (active.controller && !active.controller.signal.aborted) active.controller.abort();
        }
        activeScans.clear();
        if (observer) observer.disconnect();
        observer = null;
        return baseController.destroy();
      }
    });

    enhanceUi();
    return Object.freeze(controller);
  }

  return Object.freeze(Object.assign({}, baseApp, { createController }));
}));