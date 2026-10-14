'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const FormCore = require('../src/form-core');
global.R4G3FormCore = FormCore;
global.R4G3ApiCore = { API_ORIGIN: 'https://api.torn.com' };
const Bootstrap = require('../src/bootstrap');

function leaseDom(propertyId = 101) {
  return new JSDOM(`<!doctype html><html><body>
    <div id="market">
      <form>
        <ul class="lease-input">
          <li class="amount"><input class="input-money" type="text" value="30"></li>
          <li class="cost"><input class="lease input-money" type="text" value="0"></li>
          <li class="submit"><button type="submit">List Property</button></li>
        </ul>
      </form>
    </div>
  </body></html>`, {
    url: `https://www.torn.com/properties.php#/p=options&ID=${propertyId}&tab=lease`
  });
}

function prepare(dom, draft) {
  return FormCore.prepareLeaseForm({
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    draft
  });
}

test('lease preparer fills the matching form but keeps the draft armed for LIST PROPERTY', () => {
  const dom = leaseDom(101);
  const draft = { propertyId: 101, days: 100, totalCost: 331_667, dailyPrice: 3316 };
  let clears = 0;
  let preparedCalls = 0;
  const draftStore = {
    loadFor(id) { return id === 101 ? draft : null; },
    clear() { clears += 1; }
  };
  const preparer = Bootstrap.createLeasePreparer({
    window: dom.window,
    document: dom.window.document,
    draftStore,
    onPrepared() { preparedCalls += 1; }
  });

  const result = preparer.prepareOnce();
  assert.equal(result.prepared, true);
  assert.equal(clears, 0);
  assert.equal(preparedCalls, 1);
  assert.equal(dom.window.document.querySelector('li.amount input').value, '100');
  assert.equal(dom.window.document.querySelector('li.cost input').value, '331667');
});

test('lease lister arms only for matching route/draft/verified form and clears after one explicit list action', () => {
  const dom = leaseDom(101);
  const draft = { propertyId: 101, days: 100, totalCost: 331_667, dailyPrice: 3316 };
  let clears = 0;
  let clicks = 0;
  dom.window.document.querySelector('li.submit button').addEventListener('click', event => {
    clicks += 1;
    event.preventDefault();
  });
  const draftStore = {
    loadFor(id) { return id === 101 ? draft : null; },
    clear() { clears += 1; }
  };
  assert.equal(prepare(dom, draft).prepared, true);
  const lister = Bootstrap.createLeaseLister({
    window: dom.window,
    document: dom.window.document,
    draftStore
  });

  assert.equal(lister.canList(999), false);
  assert.equal(lister.canList(101), true);

  const result = lister.list(101);
  assert.equal(result.submitted, true);
  assert.equal(clicks, 1);
  assert.equal(clears, 1);
});

test('lease lister never submits automatically merely because a verified form is armed', () => {
  const dom = leaseDom(101);
  const draft = { propertyId: 101, days: 100, totalCost: 331_667, dailyPrice: 3316 };
  let clicks = 0;
  dom.window.document.querySelector('li.submit button').addEventListener('click', event => {
    clicks += 1;
    event.preventDefault();
  });
  assert.equal(prepare(dom, draft).prepared, true);
  const lister = Bootstrap.createLeaseLister({
    window: dom.window,
    document: dom.window.document,
    draftStore: { loadFor() { return draft; }, clear() {} }
  });

  assert.equal(lister.canList(101), true);
  assert.equal(clicks, 0);
});

test('launcher mounts only in Torn status icon bar and opens the controller', () => {
  const dom = new JSDOM('<!doctype html><html><body><ul class="status-icons"></ul></body></html>', {
    url: 'https://www.torn.com/properties.php'
  });
  let opened = 0;
  const launcher = Bootstrap.createLauncher({
    window: dom.window,
    document: dom.window.document,
    onOpen() { opened += 1; }
  });

  const item = launcher.ensure();
  assert.ok(item);
  assert.equal(item.id, 'r4g3-prm-status-launcher');
  assert.ok(dom.window.document.querySelector('ul.status-icons').contains(item));
  assert.equal(item.querySelector('button').textContent, '🏠');
  assert.equal(dom.window.document.querySelector('#r4g3-prm-floating-launcher'), null);
  item.querySelector('button').click();
  assert.equal(opened, 1);
  launcher.destroy();
  assert.equal(dom.window.document.querySelector('#r4g3-prm-status-launcher'), null);
});

test('launcher does not create floating controls when status header is absent', () => {
  const dom = new JSDOM('<!doctype html><html><body><main>Properties</main></body></html>', {
    url: 'https://www.torn.com/properties.php'
  });
  const launcher = Bootstrap.createLauncher({
    window: dom.window,
    document: dom.window.document,
    onOpen() {}
  });
  assert.equal(launcher.ensure(), null);
  assert.equal(dom.window.document.querySelector('#r4g3-prm-floating-launcher'), null);
  launcher.destroy();
});


test('launcher and rental decorations recover after Torn header and panel redraw', async () => {
  const dom = new JSDOM('<!doctype html><html><body><header><ul class="status-icons"></ul></header></body></html>', {
    url: 'https://www.torn.com/properties.php'
  });
  let decorated = 0;
  const launcher = Bootstrap.createLauncher({
    window: dom.window,
    document: dom.window.document,
    onOpen() {},
    onEnsure() { decorated += 1; }
  });
  launcher.start();
  assert.ok(dom.window.document.querySelector('#r4g3-prm-status-launcher'));
  dom.window.document.querySelector('header').innerHTML = '<ul class="status-icons"></ul>';
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  assert.ok(dom.window.document.querySelector('header #r4g3-prm-status-launcher'));
  const before = decorated;
  const panel = dom.window.document.createElement('aside');
  panel.id = 'r4g3-prm-panel';
  panel.innerHTML = '<section data-property-id="101"></section>';
  dom.window.document.body.appendChild(panel);
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  assert.ok(decorated > before, 'newly rendered manager panel should trigger decoration');
  launcher.destroy();
});
