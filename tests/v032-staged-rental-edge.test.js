'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const FormCore = require('../src/form-core');
const DraftCore = require('../src/draft-core');
const PropertyCore = require('../src/property-core');
const MarketCore = require('../src/market-core');
const App = require('../src/app');

global.R4G3FormCore = FormCore;
global.R4G3ApiCore = { API_ORIGIN: 'https://api.torn.com' };
const Bootstrap = require('../src/bootstrap');

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
}

function apiClient() {
  return {
    async fetchOwnedProperties() {
      return [{
        id: 101,
        property: { id: 13, name: 'Private Island' },
        owner: { id: 3877028 },
        status: 'none',
        modifications: []
      }];
    },
    async scanMarkets() {
      return {
        13: {
          rentals: [
            { modifications: [], cost: 300000, rental_period: 100 },
            { modifications: [], cost: 400000, rental_period: 100 }
          ],
          fromCache: false
        }
      };
    }
  };
}

test('PREPARE RENTAL re-prepares immediately when already on the same Torn lease route', async () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="market"><form><ul class="lease-input">
      <li class="amount"><input class="input-money" type="text" value="30"></li>
      <li class="cost"><input class="lease input-money" type="text" value="0"></li>
      <li class="submit"><button type="submit">List Property</button></li>
    </ul></form></div>
  </body></html>`, {
    url: 'https://www.torn.com/properties.php#/p=options&ID=101&tab=lease'
  });
  const store = DraftCore.createStore(memoryStorage());
  const controller = App.createController({
    window: dom.window,
    document: dom.window.document,
    storage: memoryStorage(),
    apiClient: apiClient(),
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: store,
    navigate() {},
    canListProperty() { return false; },
    listProperty() { return { submitted: false }; }
  });
  await controller.load();

  Bootstrap.decorateRentalActions({
    window: dom.window,
    document: dom.window.document,
    canListProperty: () => false,
    onPrepareRental(propertyId) {
      const pending = store.loadFor(propertyId);
      FormCore.prepareLeaseForm({
        window: dom.window,
        document: dom.window.document,
        location: dom.window.location,
        draft: pending
      });
    }
  });

  dom.window.document.querySelector('[data-property-id="101"] [data-action="set-price"]')
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, button: 0 }));
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));

  assert.equal(dom.window.document.querySelector('li.amount input').value, '100');
  assert.equal(dom.window.document.querySelector('li.cost input').value, '348250');
});

test('launcher mutation hook reapplies staged rental labels after the manager rerenders', async () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div data-property-id="101"><button data-action="set-price">SET PRICE</button><button data-action="list-property">LIST PROPERTY</button></div>
  </body></html>`, { url: 'https://www.torn.com/properties.php' });

  const launcher = Bootstrap.createLauncher({
    window: dom.window,
    document: dom.window.document,
    onOpen() {},
    onEnsure() {
      Bootstrap.decorateRentalActions({
        window: dom.window,
        document: dom.window.document,
        canListProperty: () => false
      });
    }
  });
  launcher.start();

  const prepare = dom.window.document.querySelector('[data-action="set-price"]');
  assert.equal(prepare.textContent, 'PREPARE RENTAL');

  prepare.textContent = 'SET PRICE';
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  assert.equal(prepare.textContent, 'PREPARE RENTAL');

  launcher.destroy();
});


test('TUI-001: asynchronously inserted rental rows receive staged labels', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="r4g3-prm-panel"></div><ul class="status-icons"></ul></body></html>', {
    url: 'https://www.torn.com/properties.php'
  });
  const launcher = Bootstrap.createLauncher({
    window: dom.window,
    document: dom.window.document,
    onOpen() {},
    onEnsure() {
      Bootstrap.decorateRentalActions({
        window: dom.window,
        document: dom.window.document,
        canListProperty: () => false
      });
    }
  });
  launcher.start();
  const panel = dom.window.document.getElementById('r4g3-prm-panel');
  panel.insertAdjacentHTML('beforeend',
    '<div data-property-id="101"><button data-action="set-price">SET PRICE</button><button data-action="list-property">LIST PROPERTY</button></div>');
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  assert.equal(panel.querySelector('[data-action="set-price"]').textContent, 'PREPARE RENTAL');
  launcher.destroy();
  dom.window.close();
});
