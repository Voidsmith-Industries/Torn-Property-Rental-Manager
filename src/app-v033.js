(function (root, factory) {
  const baseApp = typeof module === 'object' && module.exports ? require('./app') : root.R4G3PropertyRentalApp;
  const uiCore = typeof module === 'object' && module.exports ? require('./ui-core-v033') : root.R4G3UiCoreV033;
  const defaultMarketCore = typeof module === 'object' && module.exports ? require('./market-core') : root.R4G3MarketCore;
  const api = factory(baseApp, uiCore, defaultMarketCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalApp = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (baseApp, uiCore, defaultMarketCore) {
  'use strict';

  if (!baseApp || !uiCore || !defaultMarketCore) throw new Error('v0.3.3 app dependencies are unavailable');

  const TARGET_DAYS = 100;
  const MOBILE_BREAKPOINT = 700;

  function money(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.floor(number).toLocaleString('en-US') : 'n/a';
  }

  function percent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0';
    return Number.isInteger(number) ? String(number) : String(Math.round(number * 100) / 100);
  }

  function createElement(documentLike, tag, text) {
    const node = documentLike.createElement(tag);
    if (text != null) node.textContent = String(text);
    return node;
  }

  function button(documentLike, text, action, title) {
    const node = createElement(documentLike, 'button', text);
    node.type = 'button';
    node.dataset.action = action;
    node.dataset.noDrag = 'true';
    if (title) node.title = title;
    node.style.cursor = 'pointer';
    node.style.borderRadius = '7px';
    node.style.border = '1px solid currentColor';
    node.style.background = 'transparent';
    node.style.color = 'inherit';
    node.style.padding = '7px 10px';
    return node;
  }

  function selectControl(documentLike, role, options, selected) {
    const select = documentLike.createElement('select');
    select.dataset.role = role;
    for (const [value, label] of options) {
      const option = documentLike.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
    select.value = selected;
    select.style.width = '100%';
    select.style.padding = '8px';
    select.style.borderRadius = '7px';
    return select;
  }

  function createController(options) {
    const config = options || {};
    const windowLike = config.window;
    const documentLike = config.document;
    const storage = config.storage || windowLike && windowLike.localStorage;
    if (!windowLike || !documentLike) throw new TypeError('window and document are required');

    const propertyCore = config.propertyCore;
    const originalMarketCore = config.marketCore || defaultMarketCore;
    const originalListProperty = typeof config.listProperty === 'function'
      ? config.listProperty
      : () => ({ submitted: false, reason: 'Listing action unavailable' });
    const legacySettings = baseApp.loadSettings(storage);
    let uiSettings = uiCore.loadSettings(storage, legacySettings.undercutPercent, legacySettings.theme);
    let settingsWindow = null;
    let settingsDragCleanup = null;
    let settingsResizeObserver = null;
    let mainObserver = null;
    let destroyed = false;
    const justListed = new Set();

    const marketProxy = Object.assign({}, originalMarketCore, {
      rentalQuote(owned, listings, quoteOptions) {
        return originalMarketCore.rentalQuote(owned, listings, Object.assign({}, quoteOptions || {}, {
          targetDays: TARGET_DAYS,
          undercutPercent: uiSettings.undercutPercent,
          pricingBasis: uiSettings.pricingBasis
        }));
      }
    });

    function wrappedListProperty(propertyId) {
      const result = originalListProperty(propertyId);
      if (result && result.submitted) justListed.add(Number(propertyId));
      return result;
    }

    const baseController = baseApp.createController(Object.assign({}, config, {
      marketCore: marketProxy,
      listProperty: wrappedListProperty
    }));

    function isMobile() {
      return Number(windowLike.innerWidth) <= MOBILE_BREAKPOINT;
    }

    function currentTheme() {
      const settings = baseController.getSettings();
      return settings && settings.theme === 'light' ? 'light' : 'dark';
    }

    function themeColors() {
      return currentTheme() === 'light'
        ? { panel: '#f5f5f2', card: '#ffffff', text: '#171917', muted: '#616761', border: 'rgba(31,88,39,0.25)', accent: '#0d5c19', accentBg: 'rgba(13,92,25,0.10)' }
        : { panel: '#101512', card: '#151c17', text: '#ecf4ed', muted: '#9aa89c', border: 'rgba(116,255,139,0.24)', accent: '#74ff8b', accentBg: 'rgba(116,255,139,0.08)' };
    }

    function persistUiSettings(patch) {
      uiSettings = uiCore.saveSettings(
        storage,
        Object.assign({}, uiSettings, patch || {}),
        baseController.getSettings().undercutPercent,
        currentTheme()
      );
      return uiSettings;
    }

    function quoteForEntry(entry) {
      const market = entry && entry.market;
      return originalMarketCore.rentalQuote(
        entry && entry.property || {},
        market && Array.isArray(market.rentals) ? market.rentals : [],
        {
          targetDays: TARGET_DAYS,
          undercutPercent: uiSettings.undercutPercent,
          pricingBasis: uiSettings.pricingBasis
        }
      );
    }

    function recomputeQuotes() {
      const state = baseController.getState();
      for (const entry of state.rows || []) entry.quote = quoteForEntry(entry);
      baseController.render();
      enhanceMainPanel(true);
      return state.rows;
    }

    function findEntry(propertyId) {
      const state = baseController.getState();
      return (state.rows || []).find(entry => Number(entry.property && entry.property.id) === Number(propertyId)) || null;
    }

    function cellByLabel(row, label) {
      for (const cell of row.children) {
        const first = cell.firstElementChild;
        if (!first) continue;
        if (String(first.textContent || '').trim().toLowerCase() === `${label}:`.toLowerCase()) return cell;
      }
      return null;
    }

    function insertMedianCell(row, entry) {
      if (!entry || !entry.quote || entry.quote.medianTotal == null) return null;
      let cell = cellByLabel(row, 'Median 100-day');
      if (cell) return cell;
      cell = documentLike.createElement('div');
      const heading = createElement(documentLike, 'span', 'Median 100-day: ');
      heading.style.opacity = '0.68';
      cell.appendChild(heading);
      cell.appendChild(createElement(documentLike, 'span', `$${money(entry.quote.medianTotal)}`));
      const average = cellByLabel(row, 'Average 100-day');
      if (average && average.parentNode === row) row.insertBefore(cell, average);
      else row.appendChild(cell);
      return cell;
    }

    function statusText(entry) {
      const property = entry && entry.property || {};
      if (justListed.has(Number(property.id)) || property.status === 'for_rent') return 'LISTED FOR RENT';
      if (property.status === 'none') return 'AVAILABLE';
      return String(property.status || 'unknown').replace(/_/g, ' ').toUpperCase();
    }

    function decorateCard(row, entry) {
      const colors = themeColors();
      row.style.background = colors.card;
      row.style.border = `1px solid ${colors.border}`;
      row.style.borderRadius = '11px';
      row.style.padding = uiSettings.density === 'compact' ? '9px 10px' : '14px';
      row.style.margin = uiSettings.density === 'compact' ? '6px 8px' : '9px';
      row.style.boxShadow = currentTheme() === 'light' ? '0 2px 8px rgba(0,0,0,0.05)' : '0 4px 14px rgba(0,0,0,0.18)';

      const identity = row.firstElementChild;
      if (identity) {
        const title = identity.querySelector('strong');
        if (title) {
          title.style.fontSize = uiSettings.density === 'compact' ? '14px' : '16px';
          title.style.letterSpacing = '0.1px';
        }
        let badge = identity.querySelector('[data-role="status-badge"]');
        if (!badge) {
          badge = createElement(documentLike, 'span');
          badge.dataset.role = 'status-badge';
          identity.appendChild(badge);
        }
        badge.textContent = statusText(entry);
        badge.style.marginLeft = 'auto';
        badge.style.padding = '4px 8px';
        badge.style.borderRadius = '999px';
        badge.style.fontSize = '11px';
        badge.style.fontWeight = '700';
        badge.style.letterSpacing = '0.45px';
        badge.style.color = colors.accent;
        badge.style.background = colors.accentBg;
        badge.style.border = `1px solid ${colors.border}`;
      }

      const image = row.querySelector('[data-role="property-image"]');
      if (image && !uiSettings.showImages) image.remove();
      else if (image) {
        image.style.width = uiSettings.density === 'compact' ? '104px' : '136px';
        image.style.height = uiSettings.density === 'compact' ? '68px' : '86px';
      }

      insertMedianCell(row, entry);
      const quote = entry && entry.quote || {};
      const proposed = cellByLabel(row, 'Proposed 100-day rent');
      if (proposed) {
        proposed.style.gridColumn = uiSettings.density === 'compact' ? 'auto' : 'span 2';
        proposed.style.padding = '9px 10px';
        proposed.style.borderRadius = '8px';
        proposed.style.background = colors.accentBg;
        const value = proposed.lastElementChild;
        if (value) {
          value.style.fontSize = uiSettings.density === 'compact' ? '15px' : '18px';
          value.style.color = colors.accent;
        }
        let formula = proposed.querySelector('[data-role="pricing-formula"]');
        if (!formula) {
          formula = createElement(documentLike, 'small');
          formula.dataset.role = 'pricing-formula';
          formula.style.display = 'block';
          formula.style.marginTop = '4px';
          formula.style.color = colors.muted;
          proposed.appendChild(formula);
        }
        formula.textContent = `${uiCore.pricingBasisLabel(uiSettings.pricingBasis)} − ${percent(uiSettings.undercutPercent)}%`;
      }

      const status = cellByLabel(row, 'Status');
      if (status) status.style.display = 'none';

      const marketCells = {
        lowest: cellByLabel(row, 'Lowest 100-day'),
        median: cellByLabel(row, 'Median 100-day'),
        average: cellByLabel(row, 'Average 100-day'),
        highest: cellByLabel(row, 'Highest 100-day')
      };
      if (uiSettings.marketDetail === 'compact') {
        for (const [basis, cell] of Object.entries(marketCells)) {
          if (cell) cell.style.display = basis === uiSettings.pricingBasis ? '' : 'none';
        }
      } else {
        for (const cell of Object.values(marketCells)) if (cell) cell.style.display = '';
      }

      if (justListed.has(Number(entry && entry.property && entry.property.id))) {
        const listButton = row.querySelector('[data-action="list-property"]');
        const actionBox = listButton && listButton.parentElement;
        if (actionBox && actionBox.parentElement === row) actionBox.remove();
        let listed = row.querySelector('[data-role="v033-listed-note"]');
        if (!listed) {
          listed = createElement(documentLike, 'div', '✓ LISTED FOR RENT');
          listed.dataset.role = 'v033-listed-note';
          listed.style.gridColumn = '1 / -1';
          listed.style.fontWeight = '700';
          listed.style.color = colors.accent;
          listed.style.paddingTop = '4px';
          row.appendChild(listed);
        }
      }
    }

    function reorderCards(panel) {
      const state = baseController.getState();
      const sorted = uiCore.sortRows(state.rows || [], uiSettings, justListed);
      const resizeHandle = panel.querySelector('[data-role="resize-handle"]');
      for (const entry of sorted) {
        const id = Number(entry.property && entry.property.id);
        const row = panel.querySelector(`[data-property-id="${id}"]`);
        if (!row) continue;
        if (resizeHandle && resizeHandle.parentNode === panel) panel.insertBefore(row, resizeHandle);
        else panel.appendChild(row);
      }
    }

    function clampMainPanel(panel) {
      if (isMobile()) return;
      const width = panel.offsetWidth || parseInt(panel.style.width, 10) || 920;
      const height = panel.offsetHeight || parseInt(panel.style.height, 10) || 560;
      const position = uiCore.clampPanelPosition({
        left: parseInt(panel.style.left, 10) || 0,
        top: parseInt(panel.style.top, 10) || 0,
        width,
        height
      }, { width: windowLike.innerWidth, height: windowLike.innerHeight });
      panel.style.left = `${position.left}px`;
      panel.style.top = `${position.top}px`;
    }

    function attachWholeHeaderDrag(panel, header) {
      if (isMobile() || header.dataset.v033Drag === '1') return;
      header.dataset.v033Drag = '1';
      header.dataset.role = 'window-drag-surface';
      header.style.cursor = 'move';
      const legacyHandle = header.querySelector('[data-role="drag-handle"]');
      if (!legacyHandle) return;

      header.addEventListener('mousedown', event => {
        if (event.button != null && event.button !== 0) return;
        if (event.target && event.target.closest && event.target.closest('button,input,select,textarea,a,[data-no-drag="true"],[data-role="drag-handle"]')) return;
        legacyHandle.dispatchEvent(new windowLike.MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: event.clientX,
          clientY: event.clientY
        }));
      });
      windowLike.addEventListener('mousemove', () => clampMainPanel(panel));
    }

    function styleMainHeader(panel, header) {
      const colors = themeColors();
      header.style.background = colors.panel;
      header.style.padding = '10px 12px';
      header.style.borderBottom = `1px solid ${colors.border}`;
      const title = header.querySelector('[data-role="drag-handle"]');
      if (title) {
        title.textContent = 'Property Rental Manager [BETA]';
        title.style.color = colors.accent;
        title.style.fontSize = '14px';
      }
      for (const control of header.querySelectorAll('button')) {
        control.dataset.noDrag = 'true';
        control.style.minWidth = '34px';
        control.style.height = '32px';
        control.style.padding = '4px 8px';
      }
    }

    function enhanceMainPanel(force) {
      if (destroyed) return null;
      const panel = documentLike.getElementById('r4g3-prm-panel');
      if (!panel) return null;
      if (!force && panel.dataset.v033Enhanced === '1') return panel;
      panel.dataset.v033Enhanced = '1';
      const colors = themeColors();
      panel.style.background = colors.panel;
      panel.style.color = colors.text;
      panel.style.border = `1px solid ${colors.border}`;
      panel.style.borderRadius = '12px';
      panel.style.boxShadow = '0 14px 38px rgba(0,0,0,0.38)';

      const inlineSettings = panel.querySelector('.r4g3-prm-settings');
      if (inlineSettings) inlineSettings.remove();

      const header = panel.querySelector('.r4g3-prm-header');
      if (header) {
        const oldSettings = header.querySelector('[data-action="toggle-settings"]');
        if (oldSettings) {
          oldSettings.dataset.action = 'v033-settings';
          oldSettings.dataset.noDrag = 'true';
          oldSettings.textContent = '⚙';
          oldSettings.title = 'Settings';
          oldSettings.setAttribute('aria-label', 'Settings');
          if (oldSettings.dataset.v033Click !== '1') {
            oldSettings.dataset.v033Click = '1';
            oldSettings.addEventListener('click', event => {
              event.preventDefault();
              event.stopPropagation();
              openSettings();
            });
          }
        }
        const themeButton = header.querySelector('[data-action="toggle-theme"]');
        if (themeButton) themeButton.remove();
        styleMainHeader(panel, header);
        attachWholeHeaderDrag(panel, header);
      }

      clampMainPanel(panel);
      const entries = new Map((baseController.getState().rows || []).map(entry => [Number(entry.property.id), entry]));
      for (const row of panel.querySelectorAll('[data-property-id]')) {
        const entry = entries.get(Number(row.getAttribute('data-property-id')));
        if (entry) decorateCard(row, entry);
      }
      reorderCards(panel);
      return panel;
    }

    function field(documentLikeValue, labelText, control) {
      const wrap = documentLikeValue.createElement('label');
      wrap.style.display = 'grid';
      wrap.style.gap = '6px';
      const label = createElement(documentLikeValue, 'span', labelText);
      label.style.fontWeight = '600';
      wrap.append(label, control);
      return wrap;
    }

    function section(title) {
      const colors = themeColors();
      const box = documentLike.createElement('section');
      box.style.padding = '12px';
      box.style.border = `1px solid ${colors.border}`;
      box.style.borderRadius = '9px';
      box.style.display = 'grid';
      box.style.gap = '10px';
      const heading = createElement(documentLike, 'strong', title);
      heading.style.color = colors.accent;
      box.appendChild(heading);
      return box;
    }

    function closeSettingsWindow() {
      if (settingsDragCleanup) settingsDragCleanup();
      settingsDragCleanup = null;
      if (settingsResizeObserver) settingsResizeObserver.disconnect();
      settingsResizeObserver = null;
      if (settingsWindow && settingsWindow.parentNode) settingsWindow.remove();
      settingsWindow = null;
      return true;
    }

    function persistSettingsGeometry() {
      if (!settingsWindow || isMobile()) return;
      const geometry = {
        left: parseInt(settingsWindow.style.left, 10) || uiSettings.settingsGeometry.left,
        top: parseInt(settingsWindow.style.top, 10) || uiSettings.settingsGeometry.top,
        width: settingsWindow.offsetWidth || parseInt(settingsWindow.style.width, 10) || uiSettings.settingsGeometry.width,
        height: settingsWindow.offsetHeight || parseInt(settingsWindow.style.height, 10) || uiSettings.settingsGeometry.height
      };
      persistUiSettings({ settingsGeometry: geometry });
    }

    function attachSettingsDrag(node) {
      if (isMobile()) return;
      const handle = node.querySelector('[data-role="settings-drag-handle"]');
      if (!handle) return;
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let originLeft = 0;
      let originTop = 0;

      const move = event => {
        if (!dragging) return;
        const position = uiCore.clampPanelPosition({
          left: originLeft + event.clientX - startX,
          top: originTop + event.clientY - startY,
          width: node.offsetWidth || parseInt(node.style.width, 10) || 520,
          height: node.offsetHeight || parseInt(node.style.height, 10) || 620
        }, { width: windowLike.innerWidth, height: windowLike.innerHeight });
        node.style.left = `${position.left}px`;
        node.style.top = `${position.top}px`;
      };
      const up = () => {
        if (!dragging) return;
        dragging = false;
        persistSettingsGeometry();
      };
      const down = event => {
        if (event.button != null && event.button !== 0) return;
        if (event.target && event.target.closest && event.target.closest('button,input,select,textarea,a,[data-no-drag="true"]')) return;
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        originLeft = parseInt(node.style.left, 10) || 0;
        originTop = parseInt(node.style.top, 10) || 0;
        event.preventDefault();
      };

      handle.addEventListener('pointerdown', down);
      windowLike.addEventListener('pointermove', move);
      windowLike.addEventListener('pointerup', up);
      handle.addEventListener('mousedown', down);
      windowLike.addEventListener('mousemove', move);
      windowLike.addEventListener('mouseup', up);
      settingsDragCleanup = () => {
        handle.removeEventListener('pointerdown', down);
        windowLike.removeEventListener('pointermove', move);
        windowLike.removeEventListener('pointerup', up);
        handle.removeEventListener('mousedown', down);
        windowLike.removeEventListener('mousemove', move);
        windowLike.removeEventListener('mouseup', up);
      };
    }

    function readSettingsWindow() {
      if (!settingsWindow) return null;
      return {
        pricingBasis: settingsWindow.querySelector('[data-role="pricing-basis-select"]').value,
        undercutPercent: settingsWindow.querySelector('[data-role="undercut-input"]').value,
        sortMode: settingsWindow.querySelector('[data-role="sort-mode-select"]').value,
        theme: settingsWindow.querySelector('[data-role="theme-select"]').value,
        density: settingsWindow.querySelector('[data-role="density-select"]').value,
        showImages: settingsWindow.querySelector('[data-role="show-images-input"]').checked,
        marketDetail: settingsWindow.querySelector('[data-role="market-detail-select"]').value
      };
    }

    function applySettingsFromWindow() {
      const fields = readSettingsWindow();
      if (!fields) return false;
      const oldTheme = currentTheme();
      persistUiSettings(fields);
      if (uiSettings.theme !== oldTheme) baseController.setTheme(uiSettings.theme);
      recomputeQuotes();
      closeSettingsWindow();
      renderSettingsWindow();
      return true;
    }

    function renderSettingsWindow() {
      closeSettingsWindow();
      const colors = themeColors();
      const node = documentLike.createElement('aside');
      node.id = 'r4g3-prm-settings-window';
      node.style.position = 'fixed';
      node.style.zIndex = '100000';
      node.style.boxSizing = 'border-box';
      node.style.background = colors.panel;
      node.style.color = colors.text;
      node.style.border = `1px solid ${colors.border}`;
      node.style.borderRadius = '12px';
      node.style.boxShadow = '0 16px 42px rgba(0,0,0,0.42)';
      node.style.fontFamily = 'Arial, sans-serif';
      node.style.fontSize = '13px';
      node.style.overflow = 'auto';
      node.style.maxWidth = 'calc(100vw - 16px)';
      node.style.maxHeight = 'calc(100vh - 16px)';

      if (isMobile()) {
        node.style.left = '8px';
        node.style.top = '8px';
        node.style.width = 'calc(100vw - 16px)';
        node.style.height = 'calc(100vh - 16px)';
        node.style.resize = 'none';
      } else {
        const position = uiCore.clampPanelPosition(uiSettings.settingsGeometry, { width: windowLike.innerWidth, height: windowLike.innerHeight });
        node.style.left = `${position.left}px`;
        node.style.top = `${position.top}px`;
        node.style.width = `${uiSettings.settingsGeometry.width}px`;
        node.style.height = `${uiSettings.settingsGeometry.height}px`;
        node.style.resize = 'both';
      }

      const header = documentLike.createElement('header');
      header.dataset.role = 'settings-drag-handle';
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.gap = '8px';
      header.style.position = 'sticky';
      header.style.top = '0';
      header.style.zIndex = '2';
      header.style.padding = '11px 12px';
      header.style.background = colors.panel;
      header.style.borderBottom = `1px solid ${colors.border}`;
      header.style.cursor = isMobile() ? 'default' : 'move';
      const heading = createElement(documentLike, 'strong', 'Rental Manager Settings');
      heading.style.marginRight = 'auto';
      heading.style.color = colors.accent;
      header.append(heading, button(documentLike, '×', 'v033-close-settings', 'Close Settings'));
      node.appendChild(header);

      const body = documentLike.createElement('div');
      body.style.display = 'grid';
      body.style.gap = '10px';
      body.style.padding = '10px';

      const pricing = section('PRICING');
      pricing.appendChild(field(documentLike, 'Base proposed rent on', selectControl(documentLike, 'pricing-basis-select', [
        ['lowest', 'Lowest market price'],
        ['median', 'Median market price'],
        ['average', 'Average market price'],
        ['highest', 'Highest market price']
      ], uiSettings.pricingBasis)));
      const undercut = documentLike.createElement('input');
      undercut.type = 'number';
      undercut.min = '0';
      undercut.max = '25';
      undercut.step = '0.1';
      undercut.value = String(uiSettings.undercutPercent);
      undercut.dataset.role = 'undercut-input';
      undercut.style.padding = '8px';
      undercut.style.borderRadius = '7px';
      pricing.appendChild(field(documentLike, 'Undercut %', undercut));
      const fixedPeriod = createElement(documentLike, 'small', `Rental period: ${TARGET_DAYS} days (fixed)`);
      fixedPeriod.style.color = colors.muted;
      pricing.appendChild(fixedPeriod);
      body.appendChild(pricing);

      const sorting = section('PROPERTY SORTING');
      sorting.appendChild(field(documentLike, 'Sort properties by', selectControl(documentLike, 'sort-mode-select', [
        ['recommended', 'Recommended'],
        ['name-asc', 'Property name A → Z'],
        ['name-desc', 'Property name Z → A'],
        ['rent-desc', 'Proposed rent: highest first'],
        ['rent-asc', 'Proposed rent: lowest first'],
        ['happy-desc', 'Happiness: highest first'],
        ['happy-asc', 'Happiness: lowest first'],
        ['id-asc', 'Property ID']
      ], uiSettings.sortMode)));
      const note = createElement(documentLike, 'small', 'Properties listed for rent always stay below unlisted properties.');
      note.style.color = colors.muted;
      sorting.appendChild(note);
      body.appendChild(sorting);

      const appearance = section('APPEARANCE');
      appearance.appendChild(field(documentLike, 'Theme', selectControl(documentLike, 'theme-select', [
        ['dark', 'Dark'], ['light', 'Light']
      ], currentTheme())));
      appearance.appendChild(field(documentLike, 'Card density', selectControl(documentLike, 'density-select', [
        ['comfortable', 'Comfortable'], ['compact', 'Compact']
      ], uiSettings.density)));
      appearance.appendChild(field(documentLike, 'Market details', selectControl(documentLike, 'market-detail-select', [
        ['full', 'Full'], ['compact', 'Compact']
      ], uiSettings.marketDetail)));
      const imageLabel = documentLike.createElement('label');
      imageLabel.style.display = 'flex';
      imageLabel.style.alignItems = 'center';
      imageLabel.style.gap = '8px';
      const imageCheck = documentLike.createElement('input');
      imageCheck.type = 'checkbox';
      imageCheck.checked = uiSettings.showImages;
      imageCheck.dataset.role = 'show-images-input';
      imageLabel.append(imageCheck, createElement(documentLike, 'span', 'Show property images'));
      appearance.appendChild(imageLabel);
      body.appendChild(appearance);

      const actions = documentLike.createElement('div');
      actions.style.display = 'flex';
      actions.style.gap = '8px';
      actions.style.flexWrap = 'wrap';
      const save = button(documentLike, 'Save Settings', 'v033-save-settings');
      save.style.color = colors.accent;
      actions.appendChild(save);
      body.appendChild(actions);
      node.appendChild(body);

      const api = section('TORN API');
      api.dataset.role = 'api-settings';
      api.style.margin = '0 10px 10px';
      const legacy = baseController.getSettings();
      const key = documentLike.createElement('input');
      key.type = 'password';
      key.value = '';
      key.autocomplete = 'off';
      key.dataset.role = 'api-key-input';
      key.placeholder = legacy.apiKey ? 'Enter replacement key' : 'Limited-or-higher API key';
      key.style.padding = '8px';
      key.style.borderRadius = '7px';
      api.appendChild(field(documentLike, legacy.apiKey ? 'API key (saved)' : 'API key', key));
      const apiActions = documentLike.createElement('div');
      apiActions.style.display = 'flex';
      apiActions.style.gap = '8px';
      apiActions.style.flexWrap = 'wrap';
      apiActions.appendChild(button(documentLike, legacy.apiKey ? 'Replace Key' : 'Save Key', 'v033-save-api-key'));
      if (legacy.apiKey) apiActions.appendChild(button(documentLike, 'Clear Key', 'v033-clear-api-key'));
      apiActions.appendChild(button(documentLike, 'Force Market Refresh', 'v033-force-refresh'));
      api.appendChild(apiActions);
      const privacy = createElement(documentLike, 'small', 'Your API key is stored locally in this browser and is only used for Torn API requests. The saved key is never displayed here.');
      privacy.style.color = colors.muted;
      api.appendChild(privacy);
      node.appendChild(api);

      node.addEventListener('click', event => {
        const actionNode = event.target && event.target.closest && event.target.closest('[data-action]');
        if (!actionNode || !node.contains(actionNode)) return;
        const action = actionNode.dataset.action;
        if (action === 'v033-close-settings') closeSettingsWindow();
        else if (action === 'v033-save-settings') applySettingsFromWindow();
        else if (action === 'v033-save-api-key') {
          const value = key.value.trim();
          if (value) baseController.setApiKey(value);
          key.value = '';
          renderSettingsWindow();
        } else if (action === 'v033-clear-api-key') {
          baseController.setApiKey('');
          renderSettingsWindow();
        } else if (action === 'v033-force-refresh') {
          baseController.load({ force: true }).then(() => enhanceMainPanel(true)).catch(() => enhanceMainPanel(true));
        }
      });

      documentLike.body.appendChild(node);
      settingsWindow = node;
      attachSettingsDrag(node);
      if (!isMobile() && windowLike.ResizeObserver) {
        settingsResizeObserver = new windowLike.ResizeObserver(() => persistSettingsGeometry());
        settingsResizeObserver.observe(node);
      }
      return node;
    }

    function openSettings() {
      renderSettingsWindow();
      return true;
    }

    function installObserver() {
      if (!windowLike.MutationObserver || !documentLike.body) return;
      mainObserver = new windowLike.MutationObserver(() => enhanceMainPanel(false));
      mainObserver.observe(documentLike.body, { childList: true, subtree: true });
    }

    function wrapCall(name, after) {
      return function wrapped() {
        const result = baseController[name].apply(baseController, arguments);
        if (result && typeof result.then === 'function') {
          return result.then(value => {
            enhanceMainPanel(true);
            if (after) after(value);
            return value;
          }, error => {
            enhanceMainPanel(true);
            throw error;
          });
        }
        enhanceMainPanel(true);
        if (after) after(result);
        return result;
      };
    }

    installObserver();
    enhanceMainPanel(true);

    const controller = Object.assign({}, baseController, {
      load: wrapCall('load'),
      render: wrapCall('render'),
      open: wrapCall('open'),
      close: wrapCall('close'),
      toggleMinimize: wrapCall('toggleMinimize'),
      retryMarket: wrapCall('retryMarket'),
      setPriceForProperty: wrapCall('setPriceForProperty'),
      prepareLease: wrapCall('prepareLease'),
      setTheme: wrapCall('setTheme', theme => persistUiSettings({ theme })),
      listPreparedProperty: wrapCall('listPreparedProperty'),
      setApiKey: wrapCall('setApiKey'),
      openSettings,
      getUiSettings: () => Object.assign({}, uiSettings, { settingsGeometry: Object.assign({}, uiSettings.settingsGeometry) }),
      destroy() {
        destroyed = true;
        if (mainObserver) mainObserver.disconnect();
        mainObserver = null;
        closeSettingsWindow();
        return baseController.destroy();
      }
    });

    return Object.freeze(controller);
  }

  return Object.freeze(Object.assign({}, baseApp, {
    UI_SETTINGS_KEY: uiCore.SETTINGS_KEY,
    loadUiSettings: uiCore.loadSettings,
    saveUiSettings: uiCore.saveSettings,
    createController
  }));
}));
