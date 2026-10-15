(function (root, factory) {
  const baseApp = typeof module === 'object' && module.exports ? require('./app-v034') : root.R4G3PropertyRentalApp;
  const api = factory(baseApp);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalApp = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (baseApp) {
  'use strict';

  if (!baseApp) throw new Error('v0.3.6 app dependency is unavailable');

  function createController(options) {
    const config = options || {};
    const windowLike = config.window;
    const documentLike = config.document;
    if (!windowLike || !documentLike) throw new TypeError('window and document are required');

    const baseController = baseApp.createController(config);
    let observer = null;
    let scheduled = false;
    let destroyed = false;

    function sampleText(quote) {
      const exact = Number(quote && quote.exactMatchCount) || 0;
      const used = Number(quote && quote.usedMatchCount) || 0;
      const ignored = Number(quote && quote.outlierCount) || 0;
      const counts = `Exact matches: ${exact} · Used: ${used} · Outliers ignored: ${ignored}`;
      if (quote && quote.sampleStatus === 'insufficient_market_sample') {
        return `INSUFFICIENT MARKET SAMPLE · ${counts}`;
      }
      if (quote && quote.sampleStatus === 'price_data_too_inconsistent') {
        return `PRICE DATA TOO INCONSISTENT · ${counts}`;
      }
      return counts;
    }

    function enhanceMainPanel() {
      scheduled = false;
      if (destroyed) return null;
      const panel = documentLike.getElementById('r4g3-prm-panel');
      if (!panel) return null;
      const entries = new Map((baseController.getState().rows || []).map(entry => [
        Number(entry.property && entry.property.id),
        entry
      ]));

      for (const row of panel.querySelectorAll('[data-property-id]')) {
        const entry = entries.get(Number(row.getAttribute('data-property-id')));
        const quote = entry && entry.quote;
        let note = row.querySelector('[data-role="v036-market-sample"]');
        if (!quote || !Number(quote.exactMatchCount)) {
          if (note && note.parentNode) note.remove();
          continue;
        }
        if (!note) {
          note = documentLike.createElement('div');
          note.dataset.role = 'v036-market-sample';
          note.style.gridColumn = '1 / -1';
          note.style.fontSize = '12px';
          note.style.opacity = '0.82';
          note.style.padding = '6px 8px';
          note.style.borderRadius = '7px';
          note.style.border = '1px solid rgba(128,128,128,0.25)';
          const controls = row.querySelector('[data-role="v034-card-controls"]');
          if (controls && controls.parentNode === row) row.insertBefore(note, controls);
          else row.appendChild(note);
        }
        const text = sampleText(quote);
        if (note.textContent !== text) note.textContent = text;
        note.style.fontWeight = quote.sampleStatus === 'ok' && !quote.outlierCount ? '500' : '700';
      }
      return panel;
    }

    function scheduleEnhance() {
      if (scheduled || destroyed) return;
      scheduled = true;
      Promise.resolve().then(enhanceMainPanel);
    }

    if (typeof windowLike.MutationObserver === 'function') {
      observer = new windowLike.MutationObserver(records => {
        // Only newly mounted manager panels or property rows need decoration.
        // Unrelated Torn DOM traffic must not rescan every property card.
        for (const record of records) {
          if (record.type !== 'childList') continue;
          for (const node of record.addedNodes || []) {
            if (!node || node.nodeType !== 1) continue;
            const panel = '[id="r4g3-prm-panel"]';
            const rows = '[data-property-id]';
            if (node.matches?.(panel) || node.querySelector?.(panel) ||
                (record.target?.closest?.(panel) &&
                 (node.matches?.(rows) || node.querySelector?.(rows)))) {
              scheduleEnhance();
              return;
            }
          }
        }
      });
      observer.observe(documentLike.body || documentLike.documentElement, { childList: true, subtree: true });
    }

    async function wrapAsync(method, args) {
      const result = await baseController[method](...args);
      enhanceMainPanel();
      return result;
    }

    const controller = Object.assign({}, baseController, {
      load(...args) { return wrapAsync('load', args); },
      updateAll(...args) { return wrapAsync('updateAll', args); },
      updateProperty(...args) { return wrapAsync('updateProperty', args); },
      render() {
        const result = baseController.render();
        enhanceMainPanel();
        return result;
      },
      open() {
        const result = baseController.open();
        enhanceMainPanel();
        return result;
      },
      destroy() {
        destroyed = true;
        if (observer) observer.disconnect();
        return baseController.destroy();
      }
    });

    enhanceMainPanel();
    return Object.freeze(controller);
  }

  return Object.freeze(Object.assign({}, baseApp, { createController }));
}));
