(function (root, factory) {
  const baseApp = typeof module === 'object' && module.exports ? require('./app-v0310') : root.R4G3PropertyRentalApp;
  const uiObserver = typeof module === 'object' && module.exports ? require('./ui-observer') : root.R4G3UiObserver;
  const portfolioUi = typeof module === 'object' && module.exports ? require('./portfolio-ui') : root.R4G3PortfolioUi;
  const portfolioCore = typeof module === 'object' && module.exports ? require('./portfolio-core') : root.R4G3PortfolioCore;
  const backupCore = typeof module === 'object' && module.exports ? require('./backup-core') : root.R4G3BackupCore;
  const propertyCore = typeof module === 'object' && module.exports ? require('./property-core') : root.R4G3PropertyCore;
  const api = factory(baseApp, uiObserver, portfolioUi, portfolioCore, backupCore, propertyCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalApp = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (baseApp, uiObserver, portfolioUi, portfolioCore, backupCore, propertyCore) {
  'use strict';

  if (!baseApp || typeof baseApp.createController !== 'function') throw new Error('Property Rental Manager app runtime is unavailable');
  if (!uiObserver || typeof uiObserver.createWindowProxy !== 'function') throw new Error('Property Rental Manager UI observer runtime is unavailable');
  if (!portfolioUi || typeof portfolioUi.create !== 'function') throw new Error('Property Rental Manager portfolio UI is unavailable');

  function createController(options) {
    const original = Object.assign({}, options || {});
    const config = Object.assign({}, original);
    if (config.window && config.document) {
      config.window = uiObserver.createWindowProxy(config.window, config.document);
    }
    const baseController = baseApp.createController(config);
    return portfolioUi.create({
      baseController,
      window: config.window,
      document: config.document,
      storage: original.storage || config.window && config.window.localStorage,
      portfolioCore,
      backupCore,
      propertyCore
    });
  }

  return Object.freeze(Object.assign({}, baseApp, {
    RUNTIME_VERSION: '1.0.0',
    OBSERVER_MODE: 'multiplexed',
    createController
  }));
}));