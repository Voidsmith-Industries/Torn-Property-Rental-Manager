(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalBootstrap = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const API_REQUEST_TIMEOUT_MS = 15000;

  function assertApiUrl(value) {
    const url = new URL(String(value), R4G3ApiCore.API_ORIGIN);
    if (url.origin !== R4G3ApiCore.API_ORIGIN || !url.pathname.startsWith('/v2/')) {
      throw new Error('Rejected non-Torn API request');
    }
    return url;
  }

  function makeAbortError() {
    const error = new Error('Torn API request cancelled');
    error.name = 'AbortError';
    return error;
  }

  function createApiFetch(windowLike, options) {
    const config = Object.assign({ timeoutMs: API_REQUEST_TIMEOUT_MS }, options || {});
    const timeoutMs = Math.max(1, Math.floor(Number(config.timeoutMs) || API_REQUEST_TIMEOUT_MS));
    const setTimer = windowLike && typeof windowLike.setTimeout === 'function'
      ? windowLike.setTimeout.bind(windowLike)
      : setTimeout;
    const clearTimer = windowLike && typeof windowLike.clearTimeout === 'function'
      ? windowLike.clearTimeout.bind(windowLike)
      : clearTimeout;

    function timeoutError() {
      return new Error(`Torn API request timed out after ${timeoutMs} ms`);
    }

    return function apiFetch(value, init) {
      let url;
      try {
        url = assertApiUrl(value);
      } catch (error) {
        return Promise.reject(error);
      }

      const request = init || {};
      const signal = request.signal || null;
      if (signal && signal.aborted) return Promise.reject(makeAbortError());

      if (typeof GM_xmlhttpRequest === 'function') {
        return new Promise((resolve, reject) => {
          let settled = false;
          let requestHandle = null;
          let abortListener = null;
          let watchdogId = null;

          function cleanup() {
            if (signal && abortListener && typeof signal.removeEventListener === 'function') {
              signal.removeEventListener('abort', abortListener);
            }
            if (watchdogId != null) clearTimer(watchdogId);
            abortListener = null;
            watchdogId = null;
          }

          function resolveOnce(valueToResolve) {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(valueToResolve);
          }

          function rejectOnce(error) {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
          }

          abortListener = () => {
            if (settled) return;
            if (requestHandle && typeof requestHandle.abort === 'function') {
              try { requestHandle.abort(); } catch (error) { /* Cancellation remains authoritative. */ }
            }
            rejectOnce(makeAbortError());
          };

          requestHandle = GM_xmlhttpRequest({
            method: request.method || 'GET',
            url: url.toString(),
            headers: request.headers || {},
            timeout: timeoutMs,
            onload(response) {
              const status = Number(response.status) || 0;
              resolveOnce({
                ok: status >= 200 && status < 300,
                status,
                async json() {
                  const text = response.responseText || '{}';
                  return JSON.parse(text);
                }
              });
            },
            ontimeout() {
              rejectOnce(timeoutError());
            },
            onerror() {
              rejectOnce(new Error('Torn API request failed'));
            },
            onabort() {
              rejectOnce(makeAbortError());
            }
          });

          watchdogId = setTimer(() => {
            if (settled) return;
            const error = timeoutError();
            rejectOnce(error);
            if (requestHandle && typeof requestHandle.abort === 'function') {
              try { requestHandle.abort(); } catch (abortFailure) { /* Watchdog timeout remains authoritative. */ }
            }
          }, timeoutMs);

          if (signal && typeof signal.addEventListener === 'function') {
            signal.addEventListener('abort', abortListener, { once: true });
            if (signal.aborted) abortListener();
          }
        });
      }

      if (!windowLike || typeof windowLike.fetch !== 'function') {
        return Promise.reject(new Error('No supported HTTP transport is available'));
      }

      return new Promise((resolve, reject) => {
        let settled = false;
        const watchdogId = setTimer(() => {
          if (settled) return;
          settled = true;
          reject(timeoutError());
        }, timeoutMs);

        Promise.resolve(windowLike.fetch(url.toString(), request)).then(
          response => {
            if (settled) return;
            settled = true;
            clearTimer(watchdogId);
            resolve(response);
          },
          error => {
            if (settled) return;
            settled = true;
            clearTimer(watchdogId);
            reject(error);
          }
        );
      });
    };
  }

  function findInformationSection(documentLike) {
    if (!documentLike || !documentLike.querySelectorAll) return null;
    const candidates = documentLike.querySelectorAll('h1,h2,h3,h4,h5,h6,span,div,strong');
    for (const node of candidates) {
      if (String(node.textContent || '').trim().toLowerCase() !== 'information') continue;
      if (node.closest) {
        const section = node.closest('section,aside,nav,li,div');
        if (section) return section;
      }
      if (node.parentElement) return node.parentElement;
    }
    return null;
  }

  function createLauncher(options) {
    const config = options || {};
    const windowLike = config.window;
    const documentLike = config.document;
    const onOpen = typeof config.onOpen === 'function' ? config.onOpen : () => {};
    const onEnsure = typeof config.onEnsure === 'function' ? config.onEnsure : () => {};
    let retryId = null;
    let decorationsObserver = null;
    let stopped = false;

    function ensure() {
      if (stopped || !documentLike || !documentLike.querySelector) return null;
      onEnsure();
      const bar = documentLike.querySelector('ul[class*="status-icons"], ul[class*="statusIcons"]');
      if (!bar) return null;
      let item = documentLike.getElementById('r4g3-prm-status-launcher');
      if (!item) {
        item = documentLike.createElement('li');
        item.id = 'r4g3-prm-status-launcher';
        const button = documentLike.createElement('button');
        button.type = 'button';
        button.title = 'Open Property Rental Manager';
        button.setAttribute('aria-label', 'Open Property Rental Manager');
        button.textContent = '🏠';
        button.style.cssText = 'cursor:pointer;background:transparent;border:0;min-width:24px;height:24px;padding:0 3px;font-size:20px;line-height:24px';
        button.addEventListener('click', event => {
          if (event && typeof event.preventDefault === 'function') event.preventDefault();
          onOpen();
        });
        item.appendChild(button);
      }
      if (item.parentNode !== bar) bar.prepend(item);
      return item;
    }

    function start() {
      stopped = false;
      ensure();
      // Both the manager panel and Torn header are replaced during SPA redraws.
      // Inspect added nodes only; avoid re-decorating the entire page per mutation.
      if (windowLike?.MutationObserver && documentLike?.body) {
        decorationsObserver = new windowLike.MutationObserver((records) => {
          if (stopped) return;
          const icon = documentLike.getElementById('r4g3-prm-status-launcher');
          if (!icon?.isConnected && documentLike.querySelector('ul[class*="status-icons"], ul[class*="statusIcons"]')) ensure();
          const panelAdded = records.some(record => Array.from(record.addedNodes || []).some(node =>
            node.nodeType === 1 && (node.id === 'r4g3-prm-panel' ||
              node.querySelector?.('#r4g3-prm-panel'))));
          // Existing rental actions are updated in place as text nodes. They
          // also need redecoration, not just newly inserted whole panels.
          const rentalEdited = records.some(record =>
            record.type === 'childList' && (
              record.target?.closest?.('[data-property-id]') ||
              Array.from(record.addedNodes || []).some(node => node.nodeType === 1 &&
                (node.matches?.('[data-property-id]') || node.querySelector?.('[data-property-id]')))
            ));
          if (panelAdded || rentalEdited) onEnsure();
        });
        decorationsObserver.observe(documentLike.body, { childList: true, subtree: true });
      }
      // Bounded retries cover initial header hydration, not steady-state polling.
      if (!documentLike.getElementById('r4g3-prm-status-launcher')) {
        let attempts = 0;
        const attempt = () => {
          retryId = null;
          if (stopped || ensure() || ++attempts >= 16) return;
          retryId = windowLike?.setTimeout?.(attempt, 500) ?? null;
        };
        retryId = windowLike?.setTimeout?.(attempt, 500) ?? null;
      }
      return true;
    }

    function destroy() {
      stopped = true;
      decorationsObserver?.disconnect();
      decorationsObserver = null;
      if (retryId !== null && windowLike && typeof windowLike.clearTimeout === 'function') windowLike.clearTimeout(retryId);
      retryId = null;
      const item = documentLike && documentLike.getElementById('r4g3-prm-status-launcher');
      if (item && item.parentNode) item.remove();
    }

    return Object.freeze({ ensure, start, destroy });
  }

  function createLeasePreparer(options) {
    const config = options || {};
    const windowLike = config.window;
    const documentLike = config.document;
    const draftStore = config.draftStore;
    const onPrepared = typeof config.onPrepared === 'function' ? config.onPrepared : () => {};
    let observer = null;
    let timeoutId = null;

    function stop() {
      if (observer) observer.disconnect();
      observer = null;
      if (timeoutId != null && windowLike) windowLike.clearTimeout(timeoutId);
      timeoutId = null;
    }

    function prepareOnce() {
      const propertyId = R4G3FormCore.parseLeasePropertyId(windowLike && windowLike.location);
      if (!propertyId) {
        stop();
        return { prepared: false, reason: 'Not a lease route' };
      }

      const draft = draftStore.loadFor(propertyId);
      if (!draft) {
        stop();
        return { prepared: false, reason: 'No pending lease draft' };
      }

      const result = R4G3FormCore.prepareLeaseForm({
        document: documentLike,
        window: windowLike,
        location: windowLike.location,
        draft
      });
      if (result.prepared) {
        stop();
        onPrepared(result, draft);
      }
      return result;
    }

    function prepareWithWait() {
      stop();
      const first = prepareOnce();
      if (first.prepared || first.reason !== 'Form not recognized') return first;
      if (!windowLike || !windowLike.MutationObserver || !documentLike || !documentLike.body) return first;

      observer = new windowLike.MutationObserver(() => {
        const result = prepareOnce();
        if (result.prepared) stop();
      });
      observer.observe(documentLike.body, { childList: true, subtree: true });
      timeoutId = windowLike.setTimeout(stop, 15000);
      return first;
    }

    return Object.freeze({
      prepareOnce,
      prepareWithWait,
      stop
    });
  }

  function createLeaseLister(options) {
    const config = options || {};
    const windowLike = config.window;
    const documentLike = config.document;
    const draftStore = config.draftStore;
    const onListed = typeof config.onListed === 'function' ? config.onListed : () => {};

    function markChanged(reason) {
      if (!/changed/i.test(String(reason || ''))) return;
      const summary = documentLike && documentLike.querySelector && documentLike.querySelector('.r4g3-prm-inline-summary');
      const message = 'VALUES CHANGED • Press PREPARE RENTAL again';
      if (summary && summary.textContent !== message) summary.textContent = message;
    }

    function canList(propertyId) {
      const id = Number(propertyId);
      const routeId = R4G3FormCore.parseLeasePropertyId(windowLike && windowLike.location);
      if (!Number.isInteger(id) || id <= 0 || routeId !== id) return false;
      const draft = draftStore.loadFor(id);
      if (!draft) return false;

      const verified = R4G3FormCore.verifyPreparedLeaseForm({
        document: documentLike,
        window: windowLike,
        location: windowLike.location,
        draft
      });
      if (!verified.verified) {
        markChanged(verified.reason);
        return false;
      }

      const submit = R4G3FormCore.findLeaseSubmitButton(documentLike, verified.form.root);
      if (!submit) return false;
      if (submit.disabled) return false;
      if (submit.getAttribute && submit.getAttribute('aria-disabled') === 'true') return false;
      return true;
    }

    function list(propertyId) {
      const id = Number(propertyId);
      const routeId = R4G3FormCore.parseLeasePropertyId(windowLike && windowLike.location);
      if (!Number.isInteger(id) || id <= 0 || routeId !== id) {
        return { submitted: false, reason: 'Matching prepared lease form is not ready' };
      }
      const draft = draftStore.loadFor(id);
      if (!draft) return { submitted: false, reason: 'No pending lease draft' };

      const result = R4G3FormCore.submitLeaseFromUserGesture({
        document: documentLike,
        window: windowLike,
        location: windowLike.location,
        draft
      });
      if (result.submitted) {
        draftStore.clear();
        onListed(result, draft);
      } else {
        markChanged(result.reason);
      }
      return result;
    }

    return Object.freeze({ canList, list });
  }

  function decorateRentalActions(options) {
    const config = options || {};
    const windowLike = config.window;
    const documentLike = config.document;
    const canListProperty = typeof config.canListProperty === 'function' ? config.canListProperty : () => false;
    const onPrepareRental = typeof config.onPrepareRental === 'function' ? config.onPrepareRental : null;
    if (!documentLike || typeof documentLike.querySelectorAll !== 'function') return 0;

    let decorated = 0;
    for (const row of documentLike.querySelectorAll('[data-property-id]')) {
      const prepare = row.querySelector('[data-action="set-price"]');
      const list = row.querySelector('[data-action="list-property"]');
      if (!prepare || !list) continue;

      const propertyId = Number(row.getAttribute('data-property-id'));
      if (prepare.textContent !== 'PREPARE RENTAL') prepare.textContent = 'PREPARE RENTAL';
      prepare.title = 'Open Torn lease options and fill the prepared 100-day rental values';

      if (onPrepareRental && prepare.dataset.r4g3PrepareHook !== '1') {
        prepare.dataset.r4g3PrepareHook = '1';
        prepare.addEventListener('click', () => {
          const run = () => onPrepareRental(propertyId);
          if (windowLike && typeof windowLike.setTimeout === 'function') windowLike.setTimeout(run, 0);
          else Promise.resolve().then(run);
        });
      }

      const ready = canListProperty(propertyId);
      list.disabled = !ready;
      list.style.opacity = ready ? '1' : '0.45';
      list.title = ready
        ? 'Verify the visible Torn values and list this property once'
        : 'Press PREPARE RENTAL first and keep Torn\'s prepared values unchanged.';

      let status = row.querySelector('[data-role="staged-rental-status"]');
      if (ready) {
        if (!status) {
          status = documentLike.createElement('div');
          status.setAttribute('data-role', 'staged-rental-status');
          status.style.gridColumn = '1 / -1';
          status.style.fontWeight = '700';
          status.style.marginTop = '2px';
          const actions = list.parentElement;
          if (actions && actions.parentElement === row) row.insertBefore(status, actions);
          else row.appendChild(status);
        }
        const readyText = 'READY TO LIST • 100 days • visible Torn values verified';
        if (status.textContent !== readyText) status.textContent = readyText;
      } else if (status && status.parentNode) {
        status.remove();
      }
      decorated += 1;
    }
    return decorated;
  }

  async function runInitialUpdate(controller) {
    if (!controller || typeof controller.getUpdateSettings !== 'function' || typeof controller.updateAll !== 'function') return false;
    const settings = controller.getUpdateSettings();
    if (!settings || settings.autoPageUpdate !== true) return false;
    await controller.updateAll({ source: 'automatic' });
    return true;
  }

  function start(windowLike) {
    const win = windowLike || root;
    if (!win || !win.document || !win.location) return null;
    if (win.location.hostname !== 'www.torn.com' || win.location.pathname !== '/properties.php') return null;

    const draftStore = R4G3DraftCore.createStore(win.sessionStorage);
    const apiFetch = createApiFetch(win);
    let controller = null;
    let refreshRentalActions = () => {};
    const leasePreparer = createLeasePreparer({
      window: win,
      document: win.document,
      draftStore,
      onPrepared() {
        if (controller) {
          controller.render();
          refreshRentalActions();
        }
      }
    });
    const leaseLister = createLeaseLister({
      window: win,
      document: win.document,
      draftStore
    });

    controller = R4G3PropertyRentalApp.createController({
      window: win,
      document: win.document,
      storage: win.localStorage,
      propertyCore: R4G3PropertyCore,
      marketCore: R4G3MarketCore,
      draftStore,
      apiClientFactory(apiKey) {
        return R4G3ApiCore.createClient({
          apiKey,
          fetchImpl: apiFetch,
          storage: win.localStorage
        });
      },
      navigate(url) {
        win.location.href = url;
      },
      canListProperty(propertyId) {
        return leaseLister.canList(propertyId);
      },
      listProperty(propertyId) {
        return leaseLister.list(propertyId);
      },
      prepareCancelProperty(propertyId) {
        const id = Number(propertyId);
        if (!Number.isInteger(id) || id <= 0) return { prepared: false, reason: 'Invalid property ID' };
        win.location.href = R4G3PropertyCore.leaseUrl(id);
        return { prepared: true, propertyId: id };
      },
      canCancelProperty(propertyId) {
        return R4G3FormCore.canCancelRentalListing({
          document: win.document,
          location: win.location,
          propertyId
        });
      },
      cancelProperty(propertyId) {
        return R4G3FormCore.cancelRentalListingFromUserGesture({
          document: win.document,
          location: win.location,
          propertyId
        });
      },
      canConfirmCancelProperty(propertyId) {
        return R4G3FormCore.canConfirmRentalCancellation({
          document: win.document,
          location: win.location,
          propertyId
        });
      },
      confirmCancelProperty(propertyId) {
        return R4G3FormCore.confirmRentalCancellationFromUserGesture({
          document: win.document,
          location: win.location,
          propertyId
        });
      }
    });

    refreshRentalActions = () => decorateRentalActions({
      window: win,
      document: win.document,
      canListProperty(propertyId) {
        return leaseLister.canList(propertyId);
      },
      onPrepareRental() {
        leasePreparer.prepareWithWait();
      }
    });

    const launcher = createLauncher({
      window: win,
      document: win.document,
      onOpen() {
        controller.open();
        refreshRentalActions();
      },
      onEnsure() {
        refreshRentalActions();
      }
    });

    const onHashChange = () => {
      leasePreparer.prepareWithWait();
      controller.render();
      refreshRentalActions();
      launcher.ensure();
    };
    win.addEventListener('hashchange', onHashChange);
    leasePreparer.prepareWithWait();
    launcher.start();
    runInitialUpdate(controller).then(() => {
      refreshRentalActions();
    }).catch(() => {
      // The controller renders a sanitized error state. Never log the API key-bearing error.
    });

    return Object.freeze({
      controller,
      leasePreparer,
      leaseLister,
      launcher,
      refreshRentalActions,
      destroy() {
        win.removeEventListener('hashchange', onHashChange);
        leasePreparer.stop();
        launcher.destroy();
        controller.destroy();
      }
    });
  }

  return Object.freeze({
    API_REQUEST_TIMEOUT_MS,
    assertApiUrl,
    createApiFetch,
    findInformationSection,
    createLauncher,
    createLeasePreparer,
    createLeaseLister,
    decorateRentalActions,
    runInitialUpdate,
    start
  });
}));