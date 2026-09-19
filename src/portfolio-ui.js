(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PortfolioUi = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function money(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.floor(number).toLocaleString('en-US') : 'n/a';
  }

  function create(options) {
    const config = options || {};
    const base = config.baseController;
    const windowLike = config.window;
    const documentLike = config.document;
    const storage = config.storage || windowLike && windowLike.localStorage;
    const portfolio = config.portfolioCore;
    const backup = config.backupCore;
    const propertyCore = config.propertyCore;
    if (!base || !windowLike || !documentLike || !portfolio || !backup || !propertyCore) {
      throw new TypeError('Portfolio UI dependencies are required');
    }

    let history = portfolio.loadHistory(storage);
    let query = '';
    let filter = 'all';
    let notice = '';
    let observer = null;
    let scheduled = false;
    let destroyed = false;

    const currentState = () => base.getState ? base.getState() : { properties: [], rows: [] };
    const propertyById = (state, id) => (state.properties || []).find(p => Number(p && p.id) === Number(id)) || null;
    const entryById = (state, id) => (state.rows || []).find(r => Number(r && r.property && r.property.id) === Number(id)) || null;

    function remember() {
      const state = currentState();
      if (!Array.isArray(state.properties) || !state.properties.length) return history;
      history = portfolio.saveHistory(storage, portfolio.recordProperties(history, state.properties, Date.now()));
      return history;
    }

    function chip(label, value, tone) {
      const node = documentLike.createElement('span');
      node.textContent = `${label} ${value}`;
      Object.assign(node.style, {
        display: 'inline-flex', alignItems: 'center', padding: '5px 8px', borderRadius: '999px',
        border: '1px solid rgba(128,128,128,.35)', fontSize: '12px', fontWeight: '700'
      });
      if (tone === 'danger') node.style.color = '#ff8f8f';
      if (tone === 'warn') node.style.color = '#ffd166';
      if (tone === 'good') node.style.color = '#74ff8b';
      return node;
    }

    function ensureDashboard(panel, state) {
      let box = panel.querySelector('#r4g3-prm-v1-dashboard');
      if (box) return box;
      box = documentLike.createElement('section');
      box.id = 'r4g3-prm-v1-dashboard';
      Object.assign(box.style, {
        margin: '8px', padding: '10px', border: '1px solid rgba(128,128,128,.30)', borderRadius: '8px',
        display: 'grid', gap: '9px', background: 'rgba(127,127,127,.06)'
      });
      const summary = documentLike.createElement('div');
      summary.dataset.role = 'portfolio-summary';
      Object.assign(summary.style, { display: 'flex', flexWrap: 'wrap', gap: '7px', alignItems: 'center' });
      box.appendChild(summary);

      const controls = documentLike.createElement('div');
      Object.assign(controls.style, {
        display: 'grid', gridTemplateColumns: Number(windowLike.innerWidth) <= 700 ? '1fr' : 'minmax(180px,1fr) minmax(150px,220px)', gap: '8px'
      });
      const search = documentLike.createElement('input');
      search.type = 'search';
      search.value = query;
      search.placeholder = 'Search property, ID, renter name or renter ID';
      search.setAttribute('aria-label', 'Search properties and renters');
      Object.assign(search.style, { minHeight: '40px', width: '100%', boxSizing: 'border-box', padding: '7px 9px', borderRadius: '6px', border: '1px solid rgba(128,128,128,.45)', background: 'inherit', color: 'inherit' });
      search.addEventListener('input', () => { query = String(search.value || ''); applyFilters(panel, currentState()); });

      const select = documentLike.createElement('select');
      select.setAttribute('aria-label', 'Filter property attention state');
      Object.assign(select.style, { minHeight: '40px', width: '100%', padding: '7px 9px', borderRadius: '6px', border: '1px solid rgba(128,128,128,.45)', background: 'inherit', color: 'inherit' });
      const labels = { all: 'All properties', attention: 'Needs attention', vacant: 'Vacant', listed: 'Listed', rented: 'Rented', extension: 'Extension offered', active: 'Active / no urgent action' };
      for (const value of portfolio.ATTENTION_FILTERS) {
        const option = documentLike.createElement('option');
        option.value = value;
        option.textContent = labels[value] || value;
        option.selected = value === filter;
        select.appendChild(option);
      }
      select.addEventListener('change', () => { filter = select.value; applyFilters(panel, currentState()); });
      controls.append(search, select);
      box.appendChild(controls);

      const empty = documentLike.createElement('small');
      empty.dataset.role = 'portfolio-empty';
      empty.textContent = 'No properties match this search/filter.';
      empty.hidden = true;
      empty.style.opacity = '.75';
      box.appendChild(empty);
      if (notice) {
        const n = documentLike.createElement('small');
        n.dataset.role = 'portfolio-notice';
        n.textContent = notice;
        n.style.color = '#74ff8b';
        box.appendChild(n);
      }

      const header = panel.querySelector('.r4g3-prm-header');
      if (header && header.parentNode) header.parentNode.insertBefore(box, header.nextSibling);
      else panel.prepend(box);
      refreshSummary(box, state);
      return box;
    }

    function refreshSummary(box, state) {
      const host = box.querySelector('[data-role="portfolio-summary"]');
      if (!host) return;
      const s = portfolio.summary(state.properties || []);
      const signature = JSON.stringify(s);
      if (host.dataset.signature === signature) return;
      host.dataset.signature = signature;
      host.textContent = '';
      host.append(
        chip('Total', s.total),
        chip('Needs attention', s.attention, s.attention ? 'danger' : 'good'),
        chip('Vacant', s.vacant, s.vacant ? 'warn' : ''),
        chip('Urgent 0–3d', s.urgent, s.urgent ? 'danger' : ''),
        chip('4–7d', s.expiring, s.expiring ? 'warn' : ''),
        chip('8–14d', s.dueSoon, s.dueSoon ? 'warn' : ''),
        chip('Extension', s.extension, s.extension ? 'good' : ''),
        chip('Listed', s.listed)
      );
    }

    function applyFilters(panel, state) {
      let visible = 0;
      for (const row of panel.querySelectorAll('.r4g3-prm-property[data-property-id]')) {
        const property = propertyById(state, row.dataset.propertyId);
        const show = Boolean(property) && portfolio.matchesSearch(property, query) && portfolio.matchesFilter(property, filter);
        row.hidden = !show;
        if (show) visible += 1;
      }
      const empty = panel.querySelector('[data-role="portfolio-empty"]');
      if (empty) empty.hidden = visible > 0 || !(state.properties && state.properties.length);
    }

    function ensureLeaseInfo(row, property, entry) {
      const existing = row.querySelector('[data-role="lease-info"]');
      if (String(property.status || '').toLowerCase() !== 'rented') {
        if (existing) existing.remove();
        return;
      }
      if (existing) return;

      const box = documentLike.createElement('section');
      box.dataset.role = 'lease-info';
      Object.assign(box.style, {
        gridColumn: '1 / -1', padding: '9px', borderRadius: '7px',
        border: '1px solid rgba(128,128,128,.25)', display: 'grid', gap: '5px',
        background: 'rgba(127,127,127,.05)'
      });
      const renter = property.rentedBy || {};
      const days = Number(property.rentalPeriodRemaining);
      const title = documentLike.createElement('strong');
      title.textContent = `Lease • ${renter.name || 'Unknown tenant'}${renter.id ? ` [${renter.id}]` : ''}`;
      box.appendChild(title);

      const current = documentLike.createElement('div');
      current.textContent = `${Number.isFinite(days) ? `${Math.floor(days)} days remaining` : 'Days remaining unavailable'} • ${property.costPerDay != null ? `$${money(property.costPerDay)}/day` : 'Current rent unavailable'} • Extension: ${portfolio.extensionLabel(property)}`;
      box.appendChild(current);

      const quote = entry && entry.quote;
      const comparison = documentLike.createElement('small');
      if (quote && quote.proposedTotal != null && Number(quote.targetDays)) {
        const proposed = quote.proposedTotal / quote.targetDays;
        const actual = Number(property.costPerDay);
        comparison.textContent = Number.isFinite(actual) && actual > 0
          ? `Current $${money(actual)}/day • Market proposal $${money(proposed)}/day (${((proposed - actual) / actual * 100) >= 0 ? '+' : ''}${((proposed - actual) / actual * 100).toFixed(1)}%).`
          : `Current market proposal: $${money(proposed)}/day.`;
      } else {
        comparison.textContent = 'Current market proposal unavailable until this property market is scanned.';
      }
      box.appendChild(comparison);

      const previous = portfolio.previousLease(history, property.id);
      const historyLine = documentLike.createElement('small');
      historyLine.style.opacity = '.78';
      historyLine.textContent = previous
        ? `Previous locally observed lease: ${previous.tenantName || previous.tenantId || 'Unknown tenant'} • ${previous.costPerDay != null ? `$${money(previous.costPerDay)}/day` : 'rent unavailable'}${previous.rentalPeriod != null ? ` • ${Math.floor(previous.rentalPeriod)}d agreement` : ''}.`
        : 'No previous locally observed lease yet. v1.0 history begins when this browser observes property refreshes.';
      box.appendChild(historyLine);

      if (!portfolio.hasExtensionOffer(property) && Number.isFinite(days) && days <= 14) {
        const button = documentLike.createElement('button');
        button.type = 'button';
        button.textContent = 'OPEN EXTENSION';
        Object.assign(button.style, {
          justifySelf: 'start', minHeight: '40px', padding: '7px 10px', borderRadius: '6px',
          border: '1px solid currentColor', background: 'transparent', color: 'inherit'
        });
        button.addEventListener('click', event => {
          event.preventDefault();
          windowLike.location.href = propertyCore.extensionUrl(property.id);
        });
        box.appendChild(button);
      }
      row.appendChild(box);
    }

    function ensureDistribution(row, entry) {
      const quote = entry && entry.quote;
      const existing = row.querySelector('[data-role="market-distribution"]');
      if (!quote || quote.sampleStatus !== 'ok') {
        if (existing) existing.remove();
        return;
      }
      if (existing) return;
      const d = portfolio.marketDistribution(quote);
      if (!d) return;
      const box = documentLike.createElement('details');
      box.dataset.role = 'market-distribution';
      Object.assign(box.style, {
        gridColumn: '1 / -1', padding: '8px 9px', borderRadius: '7px',
        border: '1px solid rgba(128,128,128,.25)'
      });
      const heading = documentLike.createElement('summary');
      heading.style.cursor = 'pointer';
      heading.style.fontWeight = '700';
      heading.textContent = `Market distribution • ${quote.usedMatchCount}/${quote.exactMatchCount} trusted • ${quote.outlierCount} outlier${quote.outlierCount === 1 ? '' : 's'} removed`;
      box.appendChild(heading);
      const totals = documentLike.createElement('div');
      totals.style.marginTop = '7px';
      totals.textContent = `100d: Low $${money(d.lowestTotal)} • P25 $${money(d.q1Total)} • Median $${money(d.medianTotal)} • Average $${money(d.averageTotal)} • P75 $${money(d.q3Total)} • High $${money(d.highestTotal)}`;
      box.appendChild(totals);
      const daily = documentLike.createElement('small');
      daily.textContent = `Per day: P25 $${money(d.q1Daily)} • Median $${money(d.medianDaily)} • P75 $${money(d.q3Daily)} • Proposed $${money(d.proposedDaily)}`;
      box.appendChild(daily);
      row.appendChild(box);
    }

    function downloadBackup() {
      if (!windowLike.Blob || !windowLike.URL || typeof windowLike.URL.createObjectURL !== 'function') {
        notice = 'Backup export unavailable in this browser context.';
        enhance(true);
        return false;
      }
      const blob = new windowLike.Blob([backup.serializeBackup(storage, Date.now())], { type: 'application/json' });
      const url = windowLike.URL.createObjectURL(blob);
      const a = documentLike.createElement('a');
      a.href = url;
      a.download = `voidsmith-property-rental-manager-backup-${new Date().toISOString().slice(0,10)}.json`;
      documentLike.body.appendChild(a);
      a.click();
      a.remove();
      windowLike.setTimeout(() => windowLike.URL.revokeObjectURL(url), 0);
      notice = 'Local backup exported. API key excluded.';
      enhance(true);
      return true;
    }

    function importText(text) {
      const result = backup.restoreBackup(storage, text);
      notice = result.valid
        ? 'Backup imported. Current API key preserved; reload Torn to apply restored UI settings.'
        : `Backup import rejected: ${result.reason}`;
      if (result.valid) history = portfolio.loadHistory(storage);
      enhance(true);
      return result;
    }

    function chooseImport() {
      const input = documentLike.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.style.display = 'none';
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file || !windowLike.FileReader) {
          input.remove();
          return;
        }
        const reader = new windowLike.FileReader();
        reader.onload = () => {
          importText(String(reader.result || ''));
          input.remove();
        };
        reader.onerror = () => {
          notice = 'Backup import failed while reading the selected file.';
          enhance(true);
          input.remove();
        };
        reader.readAsText(file);
      }, { once: true });
      documentLike.body.appendChild(input);
      input.click();
      return true;
    }

    function ensureBackupControls() {
      const settings = documentLike.getElementById('r4g3-prm-settings-window');
      if (!settings || settings.querySelector('[data-role="backup-controls"]')) return;
      const box = documentLike.createElement('section');
      box.dataset.role = 'backup-controls';
      Object.assign(box.style, {
        marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(128,128,128,.30)',
        display: 'grid', gap: '7px'
      });
      const title = documentLike.createElement('strong');
      title.textContent = 'Local backup';
      box.appendChild(title);
      const note = documentLike.createElement('small');
      note.textContent = 'Exports settings and locally observed lease history. API key and disposable market cache are never included.';
      note.style.opacity = '.78';
      box.appendChild(note);
      const actions = documentLike.createElement('div');
      Object.assign(actions.style, { display: 'flex', flexWrap: 'wrap', gap: '8px' });
      for (const [label, handler] of [['EXPORT BACKUP', downloadBackup], ['IMPORT BACKUP', chooseImport]]) {
        const b = documentLike.createElement('button');
        b.type = 'button';
        b.textContent = label;
        Object.assign(b.style, {
          minHeight: '40px', padding: '7px 10px', borderRadius: '6px',
          border: '1px solid currentColor', background: 'transparent', color: 'inherit'
        });
        b.addEventListener('click', handler);
        actions.appendChild(b);
      }
      box.appendChild(actions);
      settings.appendChild(box);
    }

    function enhance(forceNotice) {
      if (destroyed) return;
      const state = currentState();
      const panel = documentLike.getElementById('r4g3-prm-panel');
      const uiState = base.getSettings && base.getSettings().uiState;
      if (panel && uiState === 'minimized') {
        const dashboard = panel.querySelector('#r4g3-prm-v1-dashboard');
        if (dashboard) dashboard.remove();
      } else if (panel) {
        let dashboard = panel.querySelector('#r4g3-prm-v1-dashboard');
        if (forceNotice && dashboard) {
          dashboard.remove();
          dashboard = null;
        }
        dashboard = dashboard || ensureDashboard(panel, state);
        refreshSummary(dashboard, state);
        for (const row of panel.querySelectorAll('.r4g3-prm-property[data-property-id]')) {
          const property = propertyById(state, row.dataset.propertyId);
          if (!property) continue;
          const entry = entryById(state, property.id);
          row.dataset.attention = portfolio.attentionStatus(property);
          ensureLeaseInfo(row, property, entry);
          ensureDistribution(row, entry);
        }
        applyFilters(panel, state);
      }
      ensureBackupControls();
    }

    function schedule() {
      if (scheduled || destroyed) return;
      scheduled = true;
      const run = typeof windowLike.queueMicrotask === 'function'
        ? windowLike.queueMicrotask.bind(windowLike)
        : callback => Promise.resolve().then(callback);
      run(() => {
        scheduled = false;
        enhance();
      });
    }

    function managerMutation(records) {
      for (const record of Array.from(records || [])) {
        const target = record && record.target;
        if (target && target.closest && target.closest('#r4g3-prm-panel, #r4g3-prm-settings-window')) return true;
        for (const node of [...Array.from(record && record.addedNodes || []), ...Array.from(record && record.removedNodes || [])]) {
          if (!node || node.nodeType !== 1) continue;
          if (node.matches && node.matches('#r4g3-prm-panel, #r4g3-prm-settings-window')) return true;
          if (node.querySelector && node.querySelector('#r4g3-prm-panel, #r4g3-prm-settings-window')) return true;
        }
      }
      return false;
    }

    if (windowLike.MutationObserver && (documentLike.body || documentLike.documentElement)) {
      observer = new windowLike.MutationObserver(records => {
        if (managerMutation(records)) schedule();
      });
      observer.observe(documentLike.body || documentLike.documentElement, { childList: true, subtree: true });
    }

    function afterSync(name, args, rememberHistory) {
      const result = base[name](...args);
      if (rememberHistory) remember();
      enhance();
      return result;
    }

    async function afterAsync(name, args, rememberHistory) {
      const result = await base[name](...args);
      if (rememberHistory) remember();
      enhance();
      return result;
    }

    const controller = Object.assign({}, base, {
      load: typeof base.load === 'function' ? (...args) => afterAsync('load', args, true) : undefined,
      hydrate: typeof base.hydrate === 'function' ? (...args) => afterSync('hydrate', args, true) : undefined,
      updateProperty: typeof base.updateProperty === 'function' ? (...args) => afterAsync('updateProperty', args, true) : undefined,
      updateAll: typeof base.updateAll === 'function' ? (...args) => afterAsync('updateAll', args, true) : undefined,
      syncOwnedProperties: typeof base.syncOwnedProperties === 'function' ? (...args) => afterAsync('syncOwnedProperties', args, true) : undefined,
      render: (...args) => afterSync('render', args, false),
      open: (...args) => afterSync('open', args, false),
      openSettings: (...args) => afterSync('openSettings', args, false),
      exportBackup: downloadBackup,
      importBackupText: importText,
      getLeaseHistory: () => portfolio.normalizeHistory(history),
      destroy() {
        destroyed = true;
        if (observer) observer.disconnect();
        observer = null;
        return base.destroy();
      }
    });

    remember();
    enhance();
    return Object.freeze(controller);
  }

  return Object.freeze({ create });
}));