'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ApiCore = require('../src/api-core');

function okJson(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
}

test('scheduler enforces minimum spacing between request starts', async () => {
  let clock = 0;
  const starts = [];
  const scheduler = ApiCore.createScheduler({
    minGapMs: 800,
    maxPerMinute: 75,
    now: () => clock,
    sleep: async ms => { clock += ms; }
  });

  await scheduler.run(async () => { starts.push(clock); });
  await scheduler.run(async () => { starts.push(clock); });
  await scheduler.run(async () => { starts.push(clock); });

  assert.deepEqual(starts, [0, 800, 1600]);
});

test('scheduler enforces rolling request cap', async () => {
  let clock = 0;
  const starts = [];
  const scheduler = ApiCore.createScheduler({
    minGapMs: 0,
    maxPerMinute: 3,
    now: () => clock,
    sleep: async ms => { clock += ms; }
  });

  for (let i = 0; i < 4; i += 1) {
    await scheduler.run(async () => { starts.push(clock); });
  }

  assert.deepEqual(starts.slice(0, 3), [0, 0, 0]);
  assert.ok(starts[3] >= 60000, String(starts[3]));
});

test('uses Authorization header and never puts API key in URL', async () => {
  const calls = [];
  const client = ApiCore.createClient({
    apiKey: 'secret-key',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return okJson({ properties: [] });
    },
    scheduler: { run: fn => fn() }
  });

  await client.fetchOwnedProperties();

  assert.match(calls[0].url, /^https:\/\/api\.torn\.com\/v2\/user\/properties/);
  assert.equal(calls[0].url.includes('secret-key'), false);
  assert.equal(calls[0].init.headers.Authorization, 'ApiKey secret-key');
});

test('requests only properties owned by the API key owner', async () => {
  const calls = [];
  const client = ApiCore.createClient({
    apiKey: 'k',
    fetchImpl: async url => {
      calls.push(url);
      return okJson({ properties: [] });
    },
    scheduler: { run: fn => fn() }
  });

  await client.fetchOwnedProperties();
  const url = new URL(calls[0]);
  assert.equal(url.searchParams.get('filters'), 'ownedByUser');
  assert.equal(url.searchParams.get('limit'), '100');
});

test('follows valid api.torn.com pagination and rejects foreign continuation URLs', async () => {
  const calls = [];
  const responses = [
    okJson({
      properties: [{ id: 1 }],
      _metadata: { links: { next: 'https://api.torn.com/v2/user/properties?offset=100' } }
    }),
    okJson({
      properties: [{ id: 2 }],
      _metadata: { links: { next: 'https://evil.example/steal' } }
    })
  ];

  const client = ApiCore.createClient({
    apiKey: 'k',
    fetchImpl: async url => {
      calls.push(url);
      return responses.shift();
    },
    scheduler: { run: fn => fn() }
  });

  await assert.rejects(() => client.fetchOwnedProperties(), /continuation/i);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], 'https://api.torn.com/v2/user/properties?offset=100');
});

test('collects paginated property rows', async () => {
  const responses = [
    okJson({
      properties: [{ id: 1 }],
      metadata: { links: { next: '/v2/user/properties?offset=100' } }
    }),
    okJson({ properties: [{ id: 2 }] })
  ];

  const client = ApiCore.createClient({
    apiKey: 'k',
    fetchImpl: async () => responses.shift(),
    scheduler: { run: fn => fn() }
  });

  const rows = await client.fetchOwnedProperties();
  assert.deepEqual(rows.map(row => row.id), [1, 2]);
});

test('deduplicates property types during market scan', async () => {
  const calls = [];
  const client = ApiCore.createClient({
    apiKey: 'k',
    fetchImpl: async url => {
      const match = url.match(/\/market\/(\d+)\/rentals/);
      if (match) calls.push(Number(match[1]));
      return okJson({ rentals: [] });
    },
    scheduler: { run: fn => fn() },
    storage: memoryStorage()
  });

  await client.scanMarkets([
    { propertyTypeId: 13 },
    { propertyTypeId: 13 },
    { propertyTypeId: 10 },
    { propertyTypeId: 0 }
  ]);

  assert.deepEqual(calls.sort((a, b) => a - b), [10, 13]);
});

test('market scan starts all unique market requests without waiting for earlier responses', async () => {
  const pending = [];
  const calls = [];
  const client = ApiCore.createClient({
    apiKey: 'k',
    fetchImpl: url => {
      const match = url.match(/\/market\/(\d+)\/rentals/);
      if (match) calls.push(Number(match[1]));
      return new Promise(resolve => pending.push(() => resolve(okJson({ rentals: [] }))));
    },
    scheduler: { run: fn => fn() },
    storage: memoryStorage()
  });

  const scan = client.scanMarkets([
    { propertyTypeId: 10 },
    { propertyTypeId: 11 },
    { propertyTypeId: 12 }
  ]);

  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, [10, 11, 12]);

  pending.forEach(resolve => resolve());
  await scan;
});

test('market scan preserves successful markets when another property type fails and reports progress', async () => {
  const progress = [];
  const client = ApiCore.createClient({
    apiKey: 'test-api-key',
    fetchImpl: async url => {
      if (url.includes('/market/11/')) throw new Error('network down');
      return okJson({ rentals: [{ id: Number(url.match(/\/market\/(\d+)\//)[1]) }] });
    },
    sleep: async () => {},
    scheduler: { run: fn => fn() },
    storage: memoryStorage()
  });

  const markets = await client.scanMarkets([
    { propertyTypeId: 10 },
    { propertyTypeId: 11 },
    { propertyTypeId: 12 }
  ], {
    onProgress(entry) { progress.push(entry); }
  });

  assert.equal(markets[10].rentals[0].id, 10);
  assert.equal(markets[12].rentals[0].id, 12);
  assert.match(markets[11].error, /network down/i);
  assert.equal(progress.length, 3);
  assert.deepEqual(progress.map(entry => entry.done).sort((a, b) => a - b), [1, 2, 3]);
  assert.ok(progress.every(entry => entry.total === 3));
});

test('reuses fresh rental cache and force checks Torn before reusing an unchanged snapshot', async () => {
  let clock = 1_000_000;
  let fetches = 0;
  const storage = memoryStorage();
  const client = ApiCore.createClient({
    apiKey: 'k',
    now: () => clock,
    storage,
    fetchImpl: async () => {
      fetches += 1;
      return okJson({
        rentals: [{ id: fetches, cost_per_day: 100 }],
        rentals_timestamp: 123,
        rentals_delay: 900
      });
    },
    scheduler: { run: fn => fn() }
  });

  const first = await client.fetchRentalMarket(13);
  clock += 60_000;
  const cached = await client.fetchRentalMarket(13);
  const forced = await client.fetchRentalMarket(13, { force: true });

  assert.equal(fetches, 2, 'force must make a live Torn check even when data is unchanged');
  assert.equal(first.rentals[0].id, 1);
  assert.equal(cached.rentals[0].id, 1);
  assert.equal(forced.rentals[0].id, 1, 'unchanged rentals_timestamp should reuse the complete prior snapshot');
  assert.equal(forced.unchanged, true);
  assert.equal(forced.fromCache, true);
});


test('stalled Torn requests retry once on timeout and then fail closed with diagnostics', async () => {
  let calls = 0;
  const statuses = [];
  const client = ApiCore.createClient({
    apiKey: 'k',
    fetchImpl: async () => {
      calls += 1;
      throw new Error('Torn API request timed out after 5 ms');
    },
    sleep: async () => {},
    scheduler: { run: fn => fn() },
    storage: memoryStorage()
  });

  await assert.rejects(
    () => client.fetchRentalMarket(1, {
      force: true,
      onRequestStatus(entry) { statuses.push(entry); }
    }),
    /timed out/i
  );

  assert.equal(calls, 2, 'a timeout gets one bounded retry, not an indefinite retry loop');
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].type, 'retry');
  assert.equal(statuses[0].maxAttempts, 2);
  assert.match(statuses[0].message, /timed out/i);
});


test('redacts API key from thrown errors', async () => {
  const client = ApiCore.createClient({
    apiKey: 'super-secret',
    fetchImpl: async () => okJson({ error: { code: 2, error: 'Bad key super-secret' } }, 401),
    scheduler: { run: fn => fn() }
  });

  await assert.rejects(
    () => client.fetchOwnedProperties(),
    error => {
      assert.equal(String(error.message).includes('super-secret'), false);
      assert.match(error.message, /\[REDACTED\]/);
      return true;
    }
  );
});
