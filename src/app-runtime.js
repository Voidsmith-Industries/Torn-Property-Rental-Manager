(function (root, factory) {
  const baseApp = typeof module === 'object' && module.exports ? require('./app-v0310') : root.R4G3PropertyRentalApp;
  const uiObserver = typeof module === 'object' && module.exports ? require('./ui-observer') : root.R4G3UiObserver;
  const api = factory(baseApp, uiObserver);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalApp = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (baseApp, uiObserver) {
  'use strict';

  if (!baseApp || typeof baseApp.createController !== 'function') throw new Error('Property Rental Manager app runtime is unavailable');
  if (!uiObserver || typeof uiObserver.createWindowProxy !== 'function') throw new Error('Property Rental Manager UI observer runtime is unavailable');

  function createController(options) {
    const config = Object.assign({}, options || {});
    if (config.window && config.document) {
      config.window = uiObserver.createWindowProxy(config.window, config.document);
    }
    return baseApp.createController(config);
  }

  return Object.freeze(Object.assign({}, baseApp, {
    RUNTIME_VERSION: '0.4.2',
    OBSERVER_MODE: 'multiplexed',
    createController
  }));
}));
