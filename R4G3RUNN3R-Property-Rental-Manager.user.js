// ==UserScript==
// @name         R4G3RUNN3R Property Rental Manager
// @namespace    https://voidsmithindustries.com/torn/
// @version      0.4.1
// @description  Manage Torn rentals with truthful property/market timestamps, cache-aware cancellable scans, live diagnostics, and safe native actions.
// @author       R4G3RUNN3R
// @license      MIT
// @updateURL    https://voidsmithindustries.com/torn/install/property-rental-manager.user.js
// @downloadURL  https://voidsmithindustries.com/torn/install/property-rental-manager.user.js
// @supportURL   https://voidsmithindustries.com/torn/support.html
// @match        https://www.torn.com/properties.php*
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @run-at       document-idle
// ==/UserScript==

/* ===== src/property-core.js ===== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PROPERTY_IMAGE_BASE = 'https://www.torn.com/images/v2/properties/350x230/350x230_default_';
  const PROPERTY_IMAGE_SLUGS = Object.freeze({
    'trailer': 'trailer',
    'apartment': 'apartment',
    'semi-detached house': 'semi_detached',
    'detached house': 'detached',
    'beach house': 'beach_house',
    'chalet': 'chalet',
    'villa': 'villa',
    'penthouse': 'penthouse',
    'mansion': 'mansion',
    'ranch': 'ranch',
    'palace': 'palace',
    'castle': 'castle',
    'private island': 'private_island'
  });

  function asPositiveInt(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : 0;
  }

  function asNonNegativeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function normalizePerson(value) {
    if (!value || typeof value !== 'object') return null;
    const id = asPositiveInt(value.id);
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (!id && !name) return null;
    const person = {};
    if (id) person.id = id;
    if (name) person.name = name;
    return person;
  }

  function normalizeModifications(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
      .map(item => typeof item === 'string' ? item : item && item.name)
      .map(item => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean))];
  }

  function normalizeStatus(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  function propertyImageUrl(value) {
    const name = String(value == null ? '' : value).trim();
    if (!name) return '';
    const key = name.toLowerCase();
    const slug = PROPERTY_IMAGE_SLUGS[key] || key
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return slug ? `${PROPERTY_IMAGE_BASE}${slug}.png` : '';
  }

  function normalizeProperty(raw, currentUserId) {
    if (!raw || typeof raw !== 'object') return null;

    const ownerId = String(
      (raw.owner && raw.owner.id) != null ? raw.owner.id :
      raw.owner_id != null ? raw.owner_id : ''
    );

    if (currentUserId != null && ownerId !== String(currentUserId)) {
      return null;
    }

    const property = raw.property && typeof raw.property === 'object' ? raw.property : {};

    return {
      id: asPositiveInt(raw.id != null ? raw.id : raw.property_id),
      propertyTypeId: asPositiveInt(
        property.id != null ? property.id :
        raw.property_type_id != null ? raw.property_type_id : raw.type_id
      ),
      name: String(property.name != null ? property.name : raw.name != null ? raw.name : 'Unknown property'),
      ownerId,
      happy: Number(raw.happy != null ? raw.happy : property.happy != null ? property.happy : 0) || 0,
      status: normalizeStatus(raw.status),
      modifications: normalizeModifications(raw.modifications),
      cost: asNonNegativeNumber(raw.cost),
      costPerDay: asNonNegativeNumber(raw.cost_per_day != null ? raw.cost_per_day : raw.costPerDay),
      rentalPeriod: asNonNegativeNumber(raw.rental_period != null ? raw.rental_period : raw.rentalPeriod),
      rentalPeriodRemaining: asNonNegativeNumber(
        raw.rental_period_remaining != null ? raw.rental_period_remaining : raw.rentalPeriodRemaining
      ),
      rentedBy: normalizePerson(raw.rented_by != null ? raw.rented_by : raw.rentedBy),
      renterAsked: normalizePerson(raw.renter_asked != null ? raw.renter_asked : raw.renterAsked),
      leaseExtension: raw.lease_extension != null ? raw.lease_extension : raw.leaseExtension != null ? raw.leaseExtension : null,
      raw
    };
  }

  function normalizeProperties(rows, currentUserId) {
    if (!Array.isArray(rows)) return [];
    return rows
      .map(row => normalizeProperty(row, currentUserId))
      .filter(Boolean);
  }

  function isEligibleForLease(property) {
    return normalizeStatus(property && property.status) === 'none';
  }

  function leaseUrl(propertyId) {
    const id = asPositiveInt(propertyId);
    if (!id) throw new TypeError('A positive property ID is required');
    return `https://www.torn.com/properties.php#/p=options&ID=${id}&tab=lease`;
  }

  function uniquePropertyTypeIds(properties) {
    if (!Array.isArray(properties)) return [];
    return [...new Set(properties
      .map(property => asPositiveInt(property && property.propertyTypeId))
      .filter(Boolean))]
      .sort((a, b) => a - b);
  }

  return Object.freeze({
    PROPERTY_IMAGE_BASE,
    PROPERTY_IMAGE_SLUGS,
    propertyImageUrl,
    normalizeProperty,
    normalizeProperties,
    isEligibleForLease,
    leaseUrl,
    uniquePropertyTypeIds
  });
}));

/* ===== src/market-core.js ===== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3MarketCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function stringSet(values) {
    if (!Array.isArray(values)) return new Set();
    return new Set(values
      .map(value => typeof value === 'string' ? value : value && value.name)
      .map(value => typeof value === 'string' ? value.trim() : '')
      .filter(Boolean));
  }

  function normalizeRental(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      id: number(source.id != null ? source.id : source.rental_id, 0),
      happy: number(source.happy, 0),
      cost: number(source.cost, 0),
      cost_per_day: number(source.cost_per_day != null ? source.cost_per_day : source.costPerDay, 0),
      rental_period: number(source.rental_period != null ? source.rental_period : source.rentalPeriod, 0),
      market_price: number(source.market_price != null ? source.market_price : source.marketPrice, 0),
      upkeep: number(source.upkeep, 0),
      modifications: [...stringSet(source.modifications)],
      raw: source
    };
  }

  function happySimilarity(ownedHappy, listingHappy) {
    const owned = Math.max(0, number(ownedHappy, 0));
    const listing = Math.max(0, number(listingHappy, 0));
    if (owned === 0 && listing === 0) return 1;
    const denominator = Math.max(owned, 1);
    return Math.max(0, 1 - Math.abs(listing - owned) / denominator);
  }

  function modificationSimilarity(a, b) {
    const setA = stringSet(a);
    const setB = stringSet(b);
    if (setA.size === 0 && setB.size === 0) return 1;

    let intersection = 0;
    for (const value of setA) {
      if (setB.has(value)) intersection += 1;
    }
    const union = new Set([...setA, ...setB]).size;
    return union ? intersection / union : 1;
  }

  function exactModificationMatch(a, b) {
    const setA = stringSet(a);
    const setB = stringSet(b);
    if (setA.size !== setB.size) return false;
    for (const value of setA) {
      if (!setB.has(value)) return false;
    }
    return true;
  }

  function similarity(owned, listing) {
    const happyScore = happySimilarity(owned && owned.happy, listing && listing.happy);
    const modificationScore = modificationSimilarity(
      owned && owned.modifications,
      listing && listing.modifications
    );
    return happyScore * 0.7 + modificationScore * 0.3;
  }

  function withSimilarity(owned, listings) {
    return (Array.isArray(listings) ? listings : [])
      .map(normalizeRental)
      .map(row => Object.assign(row, { _similarity: similarity(owned || {}, row) }))
      .sort((a, b) => b._similarity - a._similarity || a.cost_per_day - b.cost_per_day || a.id - b.id);
  }

  function selectComparables(owned, listings) {
    const scored = withSimilarity(owned, listings);
    let selected = scored.filter(row => row._similarity >= 0.90);
    if (selected.length < 5) selected = scored.filter(row => row._similarity >= 0.75);
    if (selected.length < 5) selected = scored.slice(0, 10);
    return selected.slice(0, 30);
  }

  function percentile(sortedValues, p) {
    if (!sortedValues.length) return null;
    if (sortedValues.length === 1) return sortedValues[0];
    const index = (sortedValues.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sortedValues[lower];
    const weight = index - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  function integerMedian(sortedValues) {
    if (!sortedValues.length) return null;
    const middle = Math.floor(sortedValues.length / 2);
    if (sortedValues.length % 2) return Math.floor(sortedValues[middle]);
    return Math.floor((sortedValues[middle - 1] + sortedValues[middle]) / 2);
  }

  function rawMedian(sortedValues) {
    if (!sortedValues.length) return null;
    const middle = Math.floor(sortedValues.length / 2);
    if (sortedValues.length % 2) return sortedValues[middle];
    return (sortedValues[middle - 1] + sortedValues[middle]) / 2;
  }

  function cleanPriceRows(rows) {
    const usable = rows
      .filter(row => number(row.cost_per_day, 0) > 0)
      .sort((a, b) => a.cost_per_day - b.cost_per_day);

    if (usable.length < 4) return usable;

    const prices = usable.map(row => row.cost_per_day);
    const q1 = percentile(prices, 0.25);
    const q3 = percentile(prices, 0.75);
    const iqr = q3 - q1;
    const min = q1 - 1.5 * iqr;
    const max = q3 + 1.5 * iqr;
    const trimmed = usable.filter(row => row.cost_per_day >= min && row.cost_per_day <= max);
    return trimmed.length >= 3 ? trimmed : usable;
  }

  function marketStats(owned, listings, settings) {
    const options = Object.assign({
      undercutPercent: 0.5,
      minimumMedianRatio: 0.70
    }, settings || {});

    const selected = selectComparables(owned || {}, listings || []);
    const cleaned = cleanPriceRows(selected);

    if (!cleaned.length) {
      return {
        marketFloor: null,
        q1: null,
        median: null,
        q3: null,
        sampleSize: 0,
        averageSimilarity: 0,
        suggestedDaily: null,
        confidence: 'Low',
        comparableIds: []
      };
    }

    const prices = cleaned.map(row => row.cost_per_day).sort((a, b) => a - b);
    const marketFloor = Math.floor(prices[0]);
    const q1 = percentile(prices, 0.25);
    const q3 = percentile(prices, 0.75);
    const median = integerMedian(prices);
    const averageSimilarity = cleaned.reduce((sum, row) => sum + row._similarity, 0) / cleaned.length;
    const undercutPercent = Math.max(0, number(options.undercutPercent, 0.5));
    const minimumMedianRatio = Math.max(0, number(options.minimumMedianRatio, 0.70));
    const undercutPrice = Math.floor(marketFloor * (1 - undercutPercent / 100));
    const safetyPrice = Math.floor(median * minimumMedianRatio);
    const suggestedDaily = Math.max(1, undercutPrice, safetyPrice);

    let confidence = 'Low';
    if (cleaned.length >= 8 && averageSimilarity >= 0.90) confidence = 'High';
    else if (cleaned.length >= 5 && averageSimilarity >= 0.75) confidence = 'Medium';

    return {
      marketFloor,
      q1,
      median,
      q3,
      sampleSize: cleaned.length,
      averageSimilarity,
      suggestedDaily,
      confidence,
      comparableIds: cleaned.map(row => row.id)
    };
  }

  function filterEquivalentPriceRows(rows) {
    const ordered = (Array.isArray(rows) ? rows : [])
      .slice()
      .sort((a, b) => a.equivalentTotal - b.equivalentTotal || a.id - b.id);

    if (!ordered.length) {
      return { rows: [], sampleStatus: 'no_exact_matches', outlierCount: 0 };
    }
    if (ordered.length === 1) {
      return { rows: [], sampleStatus: 'insufficient_market_sample', outlierCount: 0 };
    }
    if (ordered.length === 2) {
      const low = ordered[0].equivalentTotal;
      const high = ordered[1].equivalentTotal;
      if (high / low > 5) {
        return { rows: [], sampleStatus: 'price_data_too_inconsistent', outlierCount: 0 };
      }
      return { rows: ordered, sampleStatus: 'ok', outlierCount: 0 };
    }

    const totals = ordered.map(row => row.equivalentTotal);
    const median = rawMedian(totals);
    const medianMin = median / 5;
    const medianMax = median * 5;
    let trusted = ordered.filter(row => row.equivalentTotal >= medianMin && row.equivalentTotal <= medianMax);

    if (trusted.length >= 4) {
      const guardedTotals = trusted.map(row => row.equivalentTotal).sort((a, b) => a - b);
      const q1 = percentile(guardedTotals, 0.25);
      const q3 = percentile(guardedTotals, 0.75);
      const iqr = q3 - q1;
      const min = q1 - 1.5 * iqr;
      const max = q3 + 1.5 * iqr;
      trusted = trusted.filter(row => row.equivalentTotal >= min && row.equivalentTotal <= max);
    }

    const outlierCount = ordered.length - trusted.length;
    if (trusted.length < 2) {
      return { rows: trusted, sampleStatus: 'price_data_too_inconsistent', outlierCount };
    }
    return { rows: trusted, sampleStatus: 'ok', outlierCount };
  }

  function emptyRentalQuote(targetDays, pricingBasis, exactMatches, filtered) {
    const trusted = filtered && Array.isArray(filtered.rows) ? filtered.rows : [];
    return {
      targetDays,
      exactMatchCount: exactMatches.length,
      usedMatchCount: trusted.length,
      outlierCount: filtered ? filtered.outlierCount : 0,
      sampleStatus: filtered ? filtered.sampleStatus : 'no_exact_matches',
      lowestTotal: null,
      medianTotal: null,
      highestTotal: null,
      averageTotal: null,
      pricingBasis,
      pricingBaseTotal: null,
      proposedTotal: null,
      exactMatches,
      trustedMatches: trusted
    };
  }

  function rentalQuote(owned, listings, settings) {
    const options = Object.assign({
      targetDays: 100,
      undercutPercent: 0.5,
      pricingBasis: 'average'
    }, settings || {});
    const targetDays = Math.max(1, Math.floor(number(options.targetDays, 100)) || 100);
    const undercutPercent = Math.max(0, number(options.undercutPercent, 0.5));
    const pricingBasis = ['lowest', 'median', 'average', 'highest'].includes(options.pricingBasis)
      ? options.pricingBasis
      : 'average';
    const rows = (Array.isArray(listings) ? listings : [])
      .map(normalizeRental)
      .filter(row => exactModificationMatch(owned && owned.modifications, row.modifications))
      .filter(row => row.cost > 0 && row.rental_period > 0)
      .map(row => Object.assign({}, row, {
        equivalentTotal: row.cost / row.rental_period * targetDays
      }));

    const filtered = filterEquivalentPriceRows(rows);
    if (filtered.sampleStatus !== 'ok') {
      return emptyRentalQuote(targetDays, pricingBasis, rows, filtered);
    }

    const trustedRows = filtered.rows;
    const totals = trustedRows.map(row => row.equivalentTotal).sort((a, b) => a - b);
    const rawAverage = totals.reduce((sum, value) => sum + value, 0) / totals.length;
    const rawBases = {
      lowest: totals[0],
      median: rawMedian(totals),
      average: rawAverage,
      highest: totals[totals.length - 1]
    };
    const lowestTotal = Math.floor(rawBases.lowest);
    const medianTotal = Math.floor(rawBases.median);
    const averageTotal = Math.floor(rawBases.average);
    const highestTotal = Math.floor(rawBases.highest);
    const displayedBases = {
      lowest: lowestTotal,
      median: medianTotal,
      average: averageTotal,
      highest: highestTotal
    };
    const pricingBaseTotal = displayedBases[pricingBasis];
    const rawPricingBase = rawBases[pricingBasis];
    const multiplier = Math.max(0, 1 - undercutPercent / 100);

    return {
      targetDays,
      exactMatchCount: rows.length,
      usedMatchCount: trustedRows.length,
      outlierCount: filtered.outlierCount,
      sampleStatus: filtered.sampleStatus,
      lowestTotal,
      medianTotal,
      highestTotal,
      averageTotal,
      pricingBasis,
      pricingBaseTotal,
      proposedTotal: Math.floor(rawPricingBase * multiplier),
      exactMatches: rows,
      trustedMatches: trustedRows
    };
  }

  return Object.freeze({
    normalizeRental,
    happySimilarity,
    modificationSimilarity,
    exactModificationMatch,
    similarity,
    selectComparables,
    marketStats,
    filterEquivalentPriceRows,
    rentalQuote
  });
}));

/* ===== src/api-core.js ===== */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3ApiCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const API_ORIGIN = 'https://api.torn.com';
  const API_BASE = `${API_ORIGIN}/v2`;
  const CACHE_PREFIX = 'r4g3_property_rental_manager.market.';
  const FALLBACK_CACHE_MS = 15 * 60 * 1000;
  const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
  const PAGE_LIMIT = 100;
  const PAGE_WORKERS = 2;
  const MAX_PAGES = 100;
  const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);

  function defaultSleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function createScheduler(options) {
    const config = Object.assign({
      minGapMs: 750,
      maxPerMinute: 80,
      now: () => Date.now(),
      sleep: defaultSleep
    }, options || {});

    const minGapMs = Math.max(0, Number(config.minGapMs) || 0);
    const maxPerMinute = Math.max(1, Math.floor(Number(config.maxPerMinute) || 80));
    const now = config.now;
    const sleep = config.sleep;
    const starts = [];
    let lastStartedAt = null;
    let slotTail = Promise.resolve();

    function prune(current) {
      while (starts.length && current - starts[0] >= 60000) starts.shift();
    }

    async function waitForSlot() {
      while (true) {
        const current = now();
        prune(current);
        const gapWait = lastStartedAt == null ? 0 : Math.max(0, minGapMs - (current - lastStartedAt));
        const capWait = starts.length >= maxPerMinute ? Math.max(0, 60000 - (current - starts[0])) : 0;
        const waitMs = Math.max(gapWait, capWait);

        if (waitMs <= 0) {
          const startedAt = now();
          prune(startedAt);
          starts.push(startedAt);
          lastStartedAt = startedAt;
          return startedAt;
        }
        await sleep(waitMs);
      }
    }

    function run(task) {
      if (typeof task !== 'function') return Promise.reject(new TypeError('Scheduler task must be a function'));
      let release;
      const previous = slotTail;
      slotTail = new Promise(resolve => { release = resolve; });

      return (async () => {
        try {
          await previous;
          await waitForSlot();
          release();
          release = null;
          return await task();
        } catch (error) {
          if (release) release();
          throw error;
        }
      })();
    }

    return Object.freeze({ run });
  }

  function safeStorage(storage) {
    if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function') return storage;
    const map = new Map();
    return {
      getItem(key) { return map.has(key) ? map.get(key) : null; },
      setItem(key, value) { map.set(key, String(value)); },
      removeItem(key) { map.delete(key); }
    };
  }

  function positiveInt(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : 0;
  }

  function redact(value, apiKey) {
    let text = String(value == null ? '' : value);
    if (apiKey) text = text.split(String(apiKey)).join('[REDACTED]');
    return text;
  }

  function apiErrorDetail(body) {
    if (!body || !body.error) return '';
    return body.error.error || body.error.message || JSON.stringify(body.error);
  }

  function apiErrorCode(body) {
    return Number(body && body.error && body.error.code) || 0;
  }

  function isRateLimited(response, body) {
    return Number(response && response.status) === 429 || apiErrorCode(body) === 5 || /too many requests/i.test(apiErrorDetail(body));
  }

  function abortError() {
    const error = new Error('Scan cancelled');
    error.name = 'AbortError';
    return error;
  }

  function isAbortError(error) {
    return Boolean(error && error.name === 'AbortError');
  }

  function throwIfAborted(signal) {
    if (signal && signal.aborted) throw abortError();
  }

  function collection(body, key) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body[key])) return body[key];
    if (body && body.data && Array.isArray(body.data[key])) return body.data[key];
    return [];
  }

  function rentalRows(body) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body.rentals)) return body.rentals;
    if (body && body.rentals && Array.isArray(body.rentals.listings)) return body.rentals.listings;
    if (body && body.data && Array.isArray(body.data.rentals)) return body.data.rentals;
    if (body && body.data && body.data.rentals && Array.isArray(body.data.rentals.listings)) return body.data.rentals.listings;
    return [];
  }

  function metadataTotal(body) {
    const candidates = [
      body && body._metadata && body._metadata.links && body._metadata.links.total,
      body && body.metadata && body.metadata.links && body.metadata.links.total,
      body && body._metadata && body._metadata.total,
      body && body.metadata && body.metadata.total
    ];
    for (const candidate of candidates) {
      const number = Number(candidate);
      if (Number.isFinite(number) && number >= 0) return Math.floor(number);
    }
    return null;
  }

  function nextLink(body) {
    if (!body || typeof body !== 'object') return null;
    return (
      body._metadata && body._metadata.links && body._metadata.links.next ||
      body.metadata && body.metadata.links && body.metadata.links.next ||
      body._metadata && body._metadata.next ||
      body.metadata && body.metadata.next ||
      null
    );
  }

  function normalizeContinuation(next) {
    if (!next) return null;
    let url;
    try {
      url = new URL(String(next), API_ORIGIN);
    } catch (error) {
      throw new Error('Invalid Torn API continuation URL');
    }
    if (url.origin !== API_ORIGIN || !url.pathname.startsWith('/v2/')) {
      throw new Error('Rejected non-Torn API continuation URL');
    }
    return url.toString();
  }

  function offsetUrl(propertyTypeId, offset) {
    const id = positiveInt(propertyTypeId);
    if (!id) throw new TypeError('A positive property type ID is required');
    const url = new URL(`${API_BASE}/market/${id}/rentals`);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    url.searchParams.set('offset', String(Math.max(0, Math.floor(Number(offset) || 0))));
    return url.toString();
  }

  function createClient(options) {
    const config = Object.assign({}, options || {});
    const apiKey = String(config.apiKey || '').trim();
    const fetchImpl = config.fetchImpl || (root && root.fetch ? root.fetch.bind(root) : null);
    const now = config.now || (() => Date.now());
    const sleep = config.sleep || defaultSleep;
    const storage = safeStorage(config.storage || (root && root.localStorage));
    const scheduler = config.scheduler || createScheduler({ now, sleep });
    let currentUserIdPromise = null;

    if (!fetchImpl) throw new Error('A fetch implementation is required');

    function emit(callback, entry) {
      if (typeof callback !== 'function') return;
      try { callback(entry); } catch (error) { /* Reporting must never break requests. */ }
    }

    async function wait(ms, signal) {
      throwIfAborted(signal);
      if (!signal || typeof signal.addEventListener !== 'function') {
        await sleep(ms);
        return;
      }
      let onAbort;
      const aborted = new Promise((resolve, reject) => {
        onAbort = () => reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
      });
      try {
        await Promise.race([sleep(ms), aborted]);
      } finally {
        if (onAbort && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort);
      }
      throwIfAborted(signal);
    }

    async function requestJson(url, attempt, requestOptions) {
      const tryNumber = attempt || 0;
      const options = requestOptions || {};
      const signal = options.signal || null;
      const onRequestStatus = typeof options.onRequestStatus === 'function' ? options.onRequestStatus : null;
      if (!apiKey) throw new Error('A Torn API key is required');
      throwIfAborted(signal);

      let response;
      try {
        response = await scheduler.run(() => {
          throwIfAborted(signal);
          return fetchImpl(url, {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `ApiKey ${apiKey}`
            },
            signal
          });
        });
      } catch (error) {
        if (isAbortError(error) || signal && signal.aborted) throw abortError();
        if (tryNumber < 2) {
          const delayMs = 250 * (tryNumber + 1);
          emit(onRequestStatus, {
            type: 'retry', attempt: tryNumber + 1, maxAttempts: 3, delayMs, status: 0,
            message: `Network request failed; retrying ${tryNumber + 1} / 2`
          });
          await wait(delayMs, signal);
          return requestJson(url, tryNumber + 1, options);
        }
        throw new Error(redact(`Torn API network error: ${error && error.message || error}`, apiKey));
      }

      throwIfAborted(signal);
      let body = null;
      try { body = await response.json(); } catch (error) { body = null; }

      if (isRateLimited(response, body)) {
        if (tryNumber < 2) {
          emit(onRequestStatus, {
            type: 'cooldown', attempt: tryNumber + 1, maxAttempts: 3,
            delayMs: RATE_LIMIT_COOLDOWN_MS, status: Number(response && response.status) || 429,
            message: 'Torn rate limit detected; cooling down before retry'
          });
          await wait(RATE_LIMIT_COOLDOWN_MS, signal);
          return requestJson(url, tryNumber + 1, options);
        }
        const detail = apiErrorDetail(body) || `HTTP ${response.status}`;
        throw new Error(redact(`Torn API rate limit: ${detail}`, apiKey));
      }

      if (!response.ok) {
        if (TRANSIENT_STATUSES.has(Number(response.status)) && tryNumber < 2) {
          const delayMs = 250 * (tryNumber + 1);
          emit(onRequestStatus, {
            type: 'retry', attempt: tryNumber + 1, maxAttempts: 3, delayMs,
            status: Number(response.status) || 0,
            message: `Torn API ${response.status}; retrying ${tryNumber + 1} / 2`
          });
          await wait(delayMs, signal);
          return requestJson(url, tryNumber + 1, options);
        }
        const detail = apiErrorDetail(body) || `HTTP ${response.status}`;
        throw new Error(redact(`Torn API ${response.status}: ${detail}`, apiKey));
      }

      if (body && body.error) throw new Error(redact(`Torn API error: ${apiErrorDetail(body)}`, apiKey));
      return body || {};
    }

    async function collectPages(initialUrl, key, requestOptions) {
      const rows = [];
      let url = initialUrl;
      for (let page = 0; page < MAX_PAGES && url; page += 1) {
        throwIfAborted(requestOptions && requestOptions.signal);
        const body = await requestJson(url, 0, requestOptions);
        rows.push(...collection(body, key));
        url = normalizeContinuation(nextLink(body));
      }
      if (url) throw new Error(`Torn API pagination exceeded ${MAX_PAGES} pages`);
      return rows;
    }

    function readCache(propertyTypeId) {
      try {
        const raw = storage.getItem(`${CACHE_PREFIX}${propertyTypeId}`);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        if (!cached || !Array.isArray(cached.rentals) || !Number.isFinite(Number(cached.fetchedAt))) return null;
        return cached;
      } catch (error) {
        return null;
      }
    }

    function writeCache(propertyTypeId, value) {
      try { storage.setItem(`${CACHE_PREFIX}${propertyTypeId}`, JSON.stringify(value)); }
      catch (error) { /* Cache failure must not break scanning. */ }
    }

    function cacheIsFresh(cached) {
      const delaySeconds = Number(cached.rentals_delay);
      const ttl = Number.isFinite(delaySeconds) && delaySeconds > 0 ? delaySeconds * 1000 : FALLBACK_CACHE_MS;
      return now() - Number(cached.fetchedAt) < ttl;
    }

    function sameRentalTimestamp(cached, firstBody) {
      if (!cached || !Array.isArray(cached.rentals) || !cached.rentals.length) return false;
      const cachedTimestamp = Number(cached.rentals_timestamp);
      const currentTimestamp = Number(firstBody && firstBody.rentals_timestamp);
      return Number.isFinite(cachedTimestamp) && Number.isFinite(currentTimestamp) && cachedTimestamp === currentTimestamp;
    }

    async function fetchCurrentUserId() {
      if (!currentUserIdPromise) {
        currentUserIdPromise = (async () => {
          const body = await requestJson(`${API_BASE}/user/basic`, 0, {});
          const profile = body && body.profile && typeof body.profile === 'object' ? body.profile : body;
          const id = positiveInt(profile && (profile.id != null ? profile.id : profile.player_id));
          if (!id) throw new Error('Torn API user/basic response did not contain a valid user id');
          return id;
        })().catch(error => {
          currentUserIdPromise = null;
          throw error;
        });
      }
      return currentUserIdPromise;
    }

    async function fetchOwnedProperties(options) {
      return collectPages(`${API_BASE}/user/properties?filters=ownedByUser&limit=100`, 'properties', options || {});
    }

    async function collectRentalPages(propertyTypeId, scanOptions, cached) {
      const options = scanOptions || {};
      const onPageProgress = typeof options.onPageProgress === 'function' ? options.onPageProgress : null;
      const firstBody = await requestJson(offsetUrl(propertyTypeId, 0), 0, options);
      const firstRows = rentalRows(firstBody);
      const total = metadataTotal(firstBody);

      if (sameRentalTimestamp(cached, firstBody)) {
        emit(onPageProgress, {
          id: Number(propertyTypeId), donePages: 1, totalPages: 1,
          rowsDone: cached.rentals.length, totalRows: total == null ? cached.rentals.length : total,
          fromCache: true, unchanged: true
        });
        return { rows: cached.rentals.slice(), firstBody, reused: true };
      }

      if (total != null) {
        const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));
        if (totalPages > MAX_PAGES) throw new Error(`Torn API pagination exceeded ${MAX_PAGES} pages`);
        let donePages = 1;
        let rowsDone = firstRows.length;
        emit(onPageProgress, { id: Number(propertyTypeId), donePages, totalPages, rowsDone, totalRows: total });

        const offsets = [];
        for (let offset = PAGE_LIMIT; offset < total; offset += PAGE_LIMIT) offsets.push(offset);
        const pageRows = new Array(offsets.length);
        let cursor = 0;

        async function worker() {
          while (true) {
            throwIfAborted(options.signal);
            const index = cursor;
            cursor += 1;
            if (index >= offsets.length) return;
            const body = await requestJson(offsetUrl(propertyTypeId, offsets[index]), 0, options);
            const rows = rentalRows(body);
            pageRows[index] = rows;
            donePages += 1;
            rowsDone += rows.length;
            emit(onPageProgress, {
              id: Number(propertyTypeId), donePages, totalPages,
              rowsDone: Math.min(rowsDone, total), totalRows: total
            });
          }
        }

        const workers = Math.min(PAGE_WORKERS, offsets.length);
        if (workers > 0) await Promise.all(Array.from({ length: workers }, () => worker()));
        return { rows: firstRows.concat(...pageRows), firstBody, reused: false };
      }

      const rows = firstRows.slice();
      let url = normalizeContinuation(nextLink(firstBody));
      let donePages = 1;
      emit(onPageProgress, { id: Number(propertyTypeId), donePages, totalPages: null, rowsDone: rows.length, totalRows: null });
      while (url && donePages < MAX_PAGES) {
        throwIfAborted(options.signal);
        const body = await requestJson(url, 0, options);
        rows.push(...rentalRows(body));
        donePages += 1;
        emit(onPageProgress, { id: Number(propertyTypeId), donePages, totalPages: null, rowsDone: rows.length, totalRows: null });
        url = normalizeContinuation(nextLink(body));
      }
      if (url) throw new Error(`Torn API pagination exceeded ${MAX_PAGES} pages`);
      return { rows, firstBody, reused: false };
    }

    async function fetchRentalMarket(propertyTypeId, options) {
      const id = positiveInt(propertyTypeId);
      if (!id) throw new TypeError('A positive property type ID is required');
      const scanOptions = options || {};
      const force = Boolean(scanOptions.force);
      const onPageProgress = typeof scanOptions.onPageProgress === 'function' ? scanOptions.onPageProgress : null;
      throwIfAborted(scanOptions.signal);
      const cached = readCache(id);

      if (!force && cached && cacheIsFresh(cached)) {
        emit(onPageProgress, {
          id, donePages: 1, totalPages: 1,
          rowsDone: cached.rentals.length, totalRows: cached.rentals.length, fromCache: true
        });
        return Object.assign({}, cached, { fromCache: true });
      }

      const result = await collectRentalPages(id, scanOptions, cached);
      const checkedAt = now();
      if (result.reused && cached) {
        const reused = Object.assign({}, cached, { checkedAt, fromCache: true, unchanged: true });
        writeCache(id, reused);
        return reused;
      }

      const rentalRoot = result.firstBody && result.firstBody.rentals && typeof result.firstBody.rentals === 'object'
        ? result.firstBody.rentals
        : result.firstBody && result.firstBody.data && result.firstBody.data.rentals && typeof result.firstBody.data.rentals === 'object'
          ? result.firstBody.data.rentals
          : null;
      const market = {
        rentals: result.rows,
        property: rentalRoot && rentalRoot.property ? rentalRoot.property : null,
        rentals_timestamp: result.firstBody.rentals_timestamp == null ? null : result.firstBody.rentals_timestamp,
        rentals_delay: result.firstBody.rentals_delay == null ? null : result.firstBody.rentals_delay,
        fetchedAt: checkedAt,
        checkedAt,
        fromCache: false,
        unchanged: false
      };
      writeCache(id, market);
      return market;
    }

    async function scanMarkets(properties, options) {
      const scanOptions = options || {};
      const onProgress = typeof scanOptions.onProgress === 'function' ? scanOptions.onProgress : null;
      const sequential = scanOptions.sequential === true;
      const betweenMarketsMs = Math.max(0, Number(scanOptions.betweenMarketsMs) || 0);
      const ids = [...new Set((Array.isArray(properties) ? properties : [])
        .map(property => positiveInt(property && property.propertyTypeId))
        .filter(Boolean))].sort((a, b) => a - b);
      const markets = {};
      let done = 0;

      async function scanOne(id) {
        throwIfAborted(scanOptions.signal);
        let market;
        try {
          market = await fetchRentalMarket(id, scanOptions);
        } catch (error) {
          if (isAbortError(error) || scanOptions.signal && scanOptions.signal.aborted) throw abortError();
          market = {
            rentals: [], property: null, rentals_timestamp: null, rentals_delay: null,
            fetchedAt: now(), checkedAt: null, fromCache: false, unchanged: false,
            error: redact(error && error.message || error, apiKey)
          };
        }
        markets[id] = market;
        done += 1;
        emit(onProgress, { id, done, total: ids.length, market });
      }

      if (sequential) {
        for (let index = 0; index < ids.length; index += 1) {
          await scanOne(ids[index]);
          if (betweenMarketsMs > 0 && index < ids.length - 1) await wait(betweenMarketsMs, scanOptions.signal);
        }
      } else {
        await Promise.all(ids.map(scanOne));
      }
      return markets;
    }

    return Object.freeze({ fetchCurrentUserId, fetchOwnedProperties, fetchRentalMarket, scanMarkets });
  }

  return Object.freeze({
    API_ORIGIN,
    API_BASE,
    RATE_LIMIT_COOLDOWN_MS,
    PAGE_LIMIT,
    PAGE_WORKERS,
    MAX_PAGES,
    metadataTotal,
    offsetUrl,
    createScheduler,
    createClient
  });
}));

/* ===== src/draft-core.js ===== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3DraftCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KEY = 'r4g3_property_rental_manager.pending_lease';
  const DEFAULT_EXPIRY_MS = 30 * 60 * 1000;

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : 0;
  }

  function optionalMoney(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
  }

  function normalizeConfidence(value) {
    return ['High', 'Medium', 'Low'].includes(value) ? value : null;
  }

  function createStore(storage, options) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {
      throw new TypeError('A sessionStorage-compatible object is required');
    }

    const config = Object.assign({
      now: () => Date.now(),
      expiryMs: DEFAULT_EXPIRY_MS
    }, options || {});
    const now = config.now;
    const expiryMs = Math.max(1, Number(config.expiryMs) || DEFAULT_EXPIRY_MS);

    function clear() {
      storage.removeItem(KEY);
    }

    function normalizeInput(draft, createdAt) {
      const source = draft && typeof draft === 'object' ? draft : {};
      const propertyId = positiveInteger(source.propertyId);
      const days = positiveInteger(source.days);
      const suppliedDailyPrice = positiveInteger(source.dailyPrice);
      const suppliedTotalCost = positiveInteger(source.totalCost);

      if (!propertyId) throw new TypeError('A positive property ID is required');
      if (!days || days > 365) throw new RangeError('Lease days must be an integer from 1 to 365');
      if (!suppliedDailyPrice && !suppliedTotalCost) throw new RangeError('Daily price or total cost must be a positive integer');

      const totalCost = suppliedTotalCost || days * suppliedDailyPrice;
      const dailyPrice = suppliedDailyPrice || Math.max(1, Math.floor(totalCost / days));
      const normalized = {
        propertyId,
        days,
        dailyPrice,
        totalCost,
        createdAt: Number.isFinite(Number(createdAt)) ? Number(createdAt) : now()
      };

      const marketFloor = optionalMoney(source.marketFloor);
      const median = optionalMoney(source.median);
      const confidence = normalizeConfidence(source.confidence);
      if (marketFloor != null) normalized.marketFloor = marketFloor;
      if (median != null) normalized.median = median;
      if (confidence) normalized.confidence = confidence;

      return normalized;
    }

    function save(draft) {
      const normalized = normalizeInput(draft, now());
      storage.setItem(KEY, JSON.stringify(normalized));
      return Object.assign({}, normalized);
    }

    function loadFor(propertyId) {
      const requestedId = positiveInteger(propertyId);
      if (!requestedId) return null;

      let parsed;
      try {
        const raw = storage.getItem(KEY);
        if (!raw) return null;
        parsed = JSON.parse(raw);
      } catch (error) {
        clear();
        return null;
      }

      let normalized;
      try {
        normalized = normalizeInput(parsed, parsed && parsed.createdAt);
      } catch (error) {
        clear();
        return null;
      }

      if (!Number.isFinite(normalized.createdAt) || now() - normalized.createdAt > expiryMs) {
        clear();
        return null;
      }

      if (normalized.propertyId !== requestedId) return null;
      return Object.assign({}, normalized);
    }

    return Object.freeze({
      save,
      loadFor,
      clear
    });
  }

  return Object.freeze({
    KEY,
    DEFAULT_EXPIRY_MS,
    createStore
  });
}));

/* ===== src/form-core.js ===== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3FormCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : 0;
  }

  function inputIntegerValue(input) {
    const raw = String(input && input.value != null ? input.value : '').trim();
    if (!raw) return 0;
    const digits = raw.replace(/[^0-9]/g, '');
    return positiveInteger(digits);
  }

  function parseLeasePropertyId(locationLike) {
    const hash = String(locationLike && locationLike.hash || '');
    if (!hash.includes('p=options') || !hash.includes('tab=lease')) return null;
    const match = hash.match(/[?&#]ID=(\d+)/i);
    const id = match ? positiveInteger(match[1]) : 0;
    return id || null;
  }

  function findLeaseForm(documentLike) {
    if (!documentLike || typeof documentLike.querySelector !== 'function') return null;
    const root = documentLike.querySelector('#market ul.lease-input');
    if (!root) return null;

    const daysInput = root.querySelector('li.amount input.input-money:not([type="hidden"])');
    const costInput = root.querySelector('li.cost input.lease.input-money:not([type="hidden"])') ||
      root.querySelector('li.cost input.lease.input-money');

    if (!daysInput || !costInput) return null;
    return { root, daysInput, costInput };
  }

  function findLeaseSubmitButton(documentLike, formRoot) {
    if (!documentLike || typeof documentLike.querySelector !== 'function') return null;
    const root = formRoot || documentLike.querySelector('#market ul.lease-input');
    if (!root) return null;

    const direct = root.querySelector('li.submit button, li.submit input[type="submit"]');
    if (direct) return direct;

    const scope = root.closest && (root.closest('form') || root.closest('section')) || root.parentElement;
    if (!scope || typeof scope.querySelectorAll !== 'function') return null;
    const candidates = [...scope.querySelectorAll('button, input[type="submit"]')];
    return candidates.find(candidate => {
      const text = String(candidate.textContent || candidate.value || '').trim();
      return /^(?:send|offer|submit|next|list property|list)$/i.test(text);
    }) || null;
  }

  function setNativeValue(input, value, windowLike) {
    if (!input) throw new TypeError('Input element is required');
    const win = windowLike || input.ownerDocument && input.ownerDocument.defaultView;
    const prototype = win && win.HTMLInputElement && win.HTMLInputElement.prototype;
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'value');

    if (descriptor && typeof descriptor.set === 'function') descriptor.set.call(input, String(value));
    else input.value = String(value);

    if (win && typeof win.Event === 'function') {
      for (const eventName of ['input', 'change', 'keyup', 'blur']) {
        input.dispatchEvent(new win.Event(eventName, { bubbles: true }));
      }
    }
  }

  function money(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'n/a';
    return Math.floor(number).toLocaleString('en-US');
  }

  function upsertSummary(formRoot, draft, totalCost) {
    const documentLike = formRoot.ownerDocument;
    let summary = documentLike.querySelector('.r4g3-prm-inline-summary');
    if (!summary) {
      summary = documentLike.createElement('div');
      summary.className = 'r4g3-prm-inline-summary';
      summary.setAttribute('role', 'status');
      formRoot.insertAdjacentElement('afterend', summary);
    }

    const bits = [
      `${draft.days} days`,
      `Total $${money(totalCost)}`
    ];
    if (draft.dailyPrice) bits.unshift(`Approx. $${money(draft.dailyPrice)}/day`);
    if (draft.marketFloor != null) bits.push(`Floor $${money(draft.marketFloor)}/day`);
    if (draft.median != null) bits.push(`Median $${money(draft.median)}/day`);
    if (draft.confidence) bits.push(`Confidence ${draft.confidence}`);

    summary.textContent = bits.join(' • ');
    return summary;
  }

  function draftLeaseValues(draft) {
    if (!draft || typeof draft !== 'object') return null;
    const days = positiveInteger(draft.days);
    const suppliedTotal = positiveInteger(draft.totalCost);
    const suppliedDaily = positiveInteger(draft.dailyPrice);
    if (!days || days > 365 || (!suppliedTotal && !suppliedDaily)) return null;
    const totalCost = suppliedTotal || days * suppliedDaily;
    const dailyPrice = suppliedDaily || Math.max(1, Math.floor(totalCost / days));
    return { days, totalCost, dailyPrice };
  }

  function prepareLeaseForm(options) {
    const config = options || {};
    const documentLike = config.document;
    const windowLike = config.window;
    const locationLike = config.location || windowLike && windowLike.location;
    const draft = config.draft && typeof config.draft === 'object' ? config.draft : null;
    const propertyId = parseLeasePropertyId(locationLike);

    if (!propertyId) return { prepared: false, reason: 'Not a lease route' };
    if (!draft || positiveInteger(draft.propertyId) !== propertyId) {
      return { prepared: false, reason: 'Draft does not match this property' };
    }

    const values = draftLeaseValues(draft);
    if (!values) return { prepared: false, reason: 'Invalid lease draft' };

    const form = findLeaseForm(documentLike);
    if (!form) return { prepared: false, reason: 'Form not recognized' };

    setNativeValue(form.daysInput, values.days, windowLike);
    setNativeValue(form.costInput, values.totalCost, windowLike);
    const summary = upsertSummary(form.root, Object.assign({}, draft, {
      days: values.days,
      dailyPrice: values.dailyPrice
    }), values.totalCost);

    return {
      prepared: true,
      propertyId,
      days: values.days,
      dailyPrice: values.dailyPrice,
      totalCost: values.totalCost,
      form,
      summary
    };
  }

  function verifyPreparedLeaseForm(options) {
    const config = options || {};
    const documentLike = config.document;
    const windowLike = config.window;
    const locationLike = config.location || windowLike && windowLike.location;
    const draft = config.draft && typeof config.draft === 'object' ? config.draft : null;
    const propertyId = parseLeasePropertyId(locationLike);

    if (!propertyId) return { verified: false, reason: 'Not a lease route' };
    if (!draft || positiveInteger(draft.propertyId) !== propertyId) {
      return { verified: false, reason: 'Draft does not match this property' };
    }

    const values = draftLeaseValues(draft);
    if (!values) return { verified: false, reason: 'Invalid lease draft' };

    const form = findLeaseForm(documentLike);
    if (!form) return { verified: false, reason: 'Form not recognized' };

    const actualDays = inputIntegerValue(form.daysInput);
    const actualTotalCost = inputIntegerValue(form.costInput);
    if (actualDays !== values.days || actualTotalCost !== values.totalCost) {
      return {
        verified: false,
        reason: 'Prepared lease values changed; press PREPARE RENTAL again',
        propertyId,
        expectedDays: values.days,
        expectedTotalCost: values.totalCost,
        actualDays,
        actualTotalCost,
        form
      };
    }

    return {
      verified: true,
      propertyId,
      days: values.days,
      dailyPrice: values.dailyPrice,
      totalCost: values.totalCost,
      form
    };
  }

  function submitLeaseFromUserGesture(options) {
    const config = options || {};
    const documentLike = config.document;
    const windowLike = config.window;
    const locationLike = config.location || windowLike && windowLike.location;
    const draft = config.draft && typeof config.draft === 'object' ? config.draft : null;

    const verified = verifyPreparedLeaseForm({
      document: documentLike,
      window: windowLike,
      location: locationLike,
      draft
    });
    if (!verified.verified) return { submitted: false, reason: verified.reason };

    const submitButton = findLeaseSubmitButton(documentLike, verified.form.root);
    if (!submitButton) return { submitted: false, reason: 'Submit control not recognized' };
    if (submitButton.disabled || submitButton.getAttribute && submitButton.getAttribute('aria-disabled') === 'true') {
      return { submitted: false, reason: 'Submit control is disabled' };
    }

    submitButton.click();
    return {
      submitted: true,
      propertyId: verified.propertyId,
      days: verified.days,
      totalCost: verified.totalCost
    };
  }

  function compactText(node) {
    return String(
      node && (node.textContent || node.value) ||
      node && node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('title')) || ''
    ).replace(/\s+/g, ' ').trim();
  }

  function isInsideManager(node) {
    return Boolean(node && node.closest && node.closest('#r4g3-prm-panel, #r4g3-prm-settings-window'));
  }

  function isDialogContainer(node) {
    return Boolean(node && node.closest && node.closest('dialog, [role="dialog"], [aria-modal="true"]'));
  }

  function findRentalCancelButton(documentLike) {
    if (!documentLike || typeof documentLike.querySelectorAll !== 'function') return null;
    const candidates = [...documentLike.querySelectorAll('button, a, input[type="button"], input[type="submit"]')];
    return candidates.find(candidate => {
      if (isInsideManager(candidate) || isDialogContainer(candidate)) return false;
      const text = compactText(candidate);
      return /remove\s+(?:this\s+)?(?:property\s+)?from\s+(?:the\s+)?market/i.test(text) ||
        /(?:remove|cancel|withdraw)\s+(?:rental\s+)?listing/i.test(text) ||
        /^delist$/i.test(text);
    }) || null;
  }

  function canCancelRentalListing(options) {
    const config = options || {};
    const propertyId = positiveInteger(config.propertyId);
    const routeId = parseLeasePropertyId(config.location);
    if (!propertyId || routeId !== propertyId) return false;
    const button = findRentalCancelButton(config.document);
    if (!button || button.disabled) return false;
    if (button.getAttribute && button.getAttribute('aria-disabled') === 'true') return false;
    return true;
  }

  function cancelRentalListingFromUserGesture(options) {
    const config = options || {};
    const propertyId = positiveInteger(config.propertyId);
    const routeId = parseLeasePropertyId(config.location);
    if (!propertyId || routeId !== propertyId) {
      return { submitted: false, reason: 'Matching rental listing route is not ready' };
    }
    const button = findRentalCancelButton(config.document);
    if (!button) return { submitted: false, reason: 'Remove from market control not recognized' };
    if (button.disabled || button.getAttribute && button.getAttribute('aria-disabled') === 'true') {
      return { submitted: false, reason: 'Remove from market control is disabled' };
    }
    button.click();
    return { submitted: true, propertyId };
  }

  function cancellationDialogText(node) {
    return compactText(node).toLowerCase();
  }

  function isRentalCancellationDialog(node) {
    if (!node || isInsideManager(node)) return false;
    const text = cancellationDialogText(node);
    const removeMarket = /remove.{0,80}(?:property|rental|listing).{0,80}(?:market)/i.test(text) ||
      /(?:property|rental|listing).{0,80}remove.{0,80}(?:market)/i.test(text) ||
      /remove.{0,80}from.{0,30}market/i.test(text);
    const confirmation = /are you sure|confirm|confirmation|yes|remove/i.test(text);
    return removeMarket && confirmation;
  }

  function findRentalCancelConfirmationButton(documentLike) {
    if (!documentLike || typeof documentLike.querySelectorAll !== 'function') return null;
    const explicitDialogs = [...documentLike.querySelectorAll('dialog, [role="dialog"], [aria-modal="true"]')];
    const dialogs = explicitDialogs.filter(isRentalCancellationDialog);
    for (const dialog of dialogs) {
      const candidates = [...dialog.querySelectorAll('button, a, input[type="button"], input[type="submit"]')];
      const button = candidates.find(candidate => {
        if (isInsideManager(candidate)) return false;
        const text = compactText(candidate);
        if (/^(?:no|cancel|back|close)$/i.test(text)) return false;
        return /^(?:yes|confirm|ok|okay)$/i.test(text) ||
          /(?:confirm|remove).{0,40}(?:property|listing|market)/i.test(text) ||
          /remove\s+(?:this\s+)?(?:property\s+)?from\s+(?:the\s+)?market/i.test(text);
      });
      if (button) return button;
    }
    return null;
  }

  function canConfirmRentalCancellation(options) {
    const config = options || {};
    const propertyId = positiveInteger(config.propertyId);
    const routeId = parseLeasePropertyId(config.location);
    if (!propertyId || routeId !== propertyId) return false;
    const button = findRentalCancelConfirmationButton(config.document);
    if (!button || button.disabled) return false;
    if (button.getAttribute && button.getAttribute('aria-disabled') === 'true') return false;
    return true;
  }

  function confirmRentalCancellationFromUserGesture(options) {
    const config = options || {};
    const propertyId = positiveInteger(config.propertyId);
    const routeId = parseLeasePropertyId(config.location);
    if (!propertyId || routeId !== propertyId) {
      return { submitted: false, reason: 'Matching rental listing route is not ready' };
    }
    const button = findRentalCancelConfirmationButton(config.document);
    if (!button) return { submitted: false, reason: 'Rental cancellation confirmation not recognized' };
    if (button.disabled || button.getAttribute && button.getAttribute('aria-disabled') === 'true') {
      return { submitted: false, reason: 'Rental cancellation confirmation is disabled' };
    }
    button.click();
    return { submitted: true, propertyId };
  }

  return Object.freeze({
    parseLeasePropertyId,
    findLeaseForm,
    findLeaseSubmitButton,
    setNativeValue,
    verifyPreparedLeaseForm,
    prepareLeaseForm,
    submitLeaseFromUserGesture,
    findRentalCancelButton,
    canCancelRentalListing,
    cancelRentalListingFromUserGesture,
    findRentalCancelConfirmationButton,
    canConfirmRentalCancellation,
    confirmRentalCancellationFromUserGesture
  });
}));

/* ===== src/settings-core.js ===== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.R4G3SettingsCore = api;
    // Temporary v0.4.0 migration alias. Older app layers still consume this global
    // while they are consolidated into the stable controller/view modules.
    root.R4G3UiCoreV033 = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SETTINGS_KEY = 'r4g3_property_rental_manager.v033';
  const PRICING_BASES = Object.freeze(['lowest', 'median', 'average', 'highest']);
  const SORT_MODES = Object.freeze([
    'recommended', 'name-asc', 'name-desc', 'rent-desc', 'rent-asc',
    'happy-desc', 'happy-asc', 'id-asc'
  ]);
  const DEFAULT_SETTINGS = Object.freeze({
    pricingBasis: 'average',
    undercutPercent: 0.5,
    sortMode: 'recommended',
    theme: 'dark',
    density: 'comfortable',
    showImages: true,
    marketDetail: 'full',
    settingsGeometry: Object.freeze({ left: 78, top: 110, width: 520, height: 620 })
  });

  function finite(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, min, max, fallback) {
    return Math.min(max, Math.max(min, finite(value, fallback)));
  }

  function normalizeGeometry(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      left: Math.round(clamp(source.left, 0, 10000, DEFAULT_SETTINGS.settingsGeometry.left)),
      top: Math.round(clamp(source.top, 0, 10000, DEFAULT_SETTINGS.settingsGeometry.top)),
      width: Math.round(clamp(source.width, 360, 1200, DEFAULT_SETTINGS.settingsGeometry.width)),
      height: Math.round(clamp(source.height, 360, 1600, DEFAULT_SETTINGS.settingsGeometry.height))
    };
  }

  function normalizeSettings(value, legacyUndercut, legacyTheme) {
    const source = value && typeof value === 'object' ? value : {};
    const fallbackUndercut = clamp(legacyUndercut, 0, 25, DEFAULT_SETTINGS.undercutPercent);
    const fallbackTheme = legacyTheme === 'light' ? 'light' : DEFAULT_SETTINGS.theme;
    return {
      pricingBasis: PRICING_BASES.includes(source.pricingBasis) ? source.pricingBasis : DEFAULT_SETTINGS.pricingBasis,
      undercutPercent: clamp(source.undercutPercent, 0, 25, fallbackUndercut),
      sortMode: SORT_MODES.includes(source.sortMode) ? source.sortMode : DEFAULT_SETTINGS.sortMode,
      theme: source.theme === 'light' || source.theme === 'dark' ? source.theme : fallbackTheme,
      density: source.density === 'compact' ? 'compact' : DEFAULT_SETTINGS.density,
      showImages: source.showImages !== false,
      marketDetail: source.marketDetail === 'compact' ? 'compact' : DEFAULT_SETTINGS.marketDetail,
      settingsGeometry: normalizeGeometry(source.settingsGeometry)
    };
  }

  function loadSettings(storage, legacyUndercut, legacyTheme) {
    if (!storage || typeof storage.getItem !== 'function') {
      return normalizeSettings({}, legacyUndercut, legacyTheme);
    }
    try {
      const raw = storage.getItem(SETTINGS_KEY);
      return normalizeSettings(raw ? JSON.parse(raw) : {}, legacyUndercut, legacyTheme);
    } catch (error) {
      return normalizeSettings({}, legacyUndercut, legacyTheme);
    }
  }

  function saveSettings(storage, next, legacyUndercut, legacyTheme) {
    const current = loadSettings(storage, legacyUndercut, legacyTheme);
    const source = next && typeof next === 'object' ? next : {};
    const merged = Object.assign({}, current, source, {
      settingsGeometry: source.settingsGeometry || current.settingsGeometry
    });
    const normalized = normalizeSettings(merged, legacyUndercut, legacyTheme);
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    }
    return normalized;
  }

  function pricingBasisLabel(value) {
    const labels = {
      lowest: 'Lowest market price',
      median: 'Median market price',
      average: 'Average market price',
      highest: 'Highest market price'
    };
    return labels[PRICING_BASES.includes(value) ? value : 'average'];
  }

  function statusGroup(entry, justListed) {
    const property = entry && entry.property || {};
    const id = Number(property.id);
    if (justListed && typeof justListed.has === 'function' && justListed.has(id)) return 3;
    const status = String(property.status || '').toLowerCase();
    if (status === 'for_rent') return 2;
    if (status === 'none') return 0;
    return 1;
  }

  function nullableNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function rowComparator(mode) {
    return function compare(a, b) {
      const ap = a && a.property || {};
      const bp = b && b.property || {};
      if (mode === 'name-desc') {
        return String(bp.name || '').localeCompare(String(ap.name || '')) || Number(ap.id) - Number(bp.id);
      }
      if (mode === 'rent-desc') {
        return nullableNumber(b && b.quote && b.quote.proposedTotal, -Infinity)
          - nullableNumber(a && a.quote && a.quote.proposedTotal, -Infinity)
          || String(ap.name || '').localeCompare(String(bp.name || ''))
          || Number(ap.id) - Number(bp.id);
      }
      if (mode === 'rent-asc') {
        return nullableNumber(a && a.quote && a.quote.proposedTotal, Infinity)
          - nullableNumber(b && b.quote && b.quote.proposedTotal, Infinity)
          || String(ap.name || '').localeCompare(String(bp.name || ''))
          || Number(ap.id) - Number(bp.id);
      }
      if (mode === 'happy-desc') {
        return nullableNumber(bp.happy, -Infinity) - nullableNumber(ap.happy, -Infinity)
          || String(ap.name || '').localeCompare(String(bp.name || ''))
          || Number(ap.id) - Number(bp.id);
      }
      if (mode === 'happy-asc') {
        return nullableNumber(ap.happy, Infinity) - nullableNumber(bp.happy, Infinity)
          || String(ap.name || '').localeCompare(String(bp.name || ''))
          || Number(ap.id) - Number(bp.id);
      }
      if (mode === 'id-asc') return Number(ap.id) - Number(bp.id);
      return String(ap.name || '').localeCompare(String(bp.name || '')) || Number(ap.id) - Number(bp.id);
    };
  }

  function sortRows(rows, settings, justListed) {
    const options = normalizeSettings(settings || {}, settings && settings.undercutPercent, settings && settings.theme);
    const compareRows = rowComparator(options.sortMode);
    return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
      const groupDifference = statusGroup(a, justListed) - statusGroup(b, justListed);
      return groupDifference || compareRows(a, b);
    });
  }

  function clampPanelPosition(geometry, viewport) {
    const source = geometry && typeof geometry === 'object' ? geometry : {};
    const view = viewport && typeof viewport === 'object' ? viewport : {};
    const width = Math.max(1, finite(source.width, 360));
    const height = Math.max(1, finite(source.height, 260));
    const viewportWidth = Math.max(16, finite(view.width, width + 16));
    const viewportHeight = Math.max(16, finite(view.height, height + 16));
    const maxLeft = Math.max(8, viewportWidth - width - 8);
    const maxTop = Math.max(8, viewportHeight - height - 8);
    return {
      left: Math.round(clamp(source.left, 8, maxLeft, 8)),
      top: Math.round(clamp(source.top, 8, maxTop, 8))
    };
  }

  return Object.freeze({
    SETTINGS_KEY,
    PRICING_BASES,
    SORT_MODES,
    DEFAULT_SETTINGS,
    normalizeSettings,
    loadSettings,
    saveSettings,
    pricingBasisLabel,
    sortRows,
    clampPanelPosition
  });
}));

/* ===== src/update-core.js ===== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.R4G3UpdateCore = api;
    // Temporary v0.4.0 migration alias for the legacy app layer.
    root.R4G3UpdateCoreV034 = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SETTINGS_KEY = 'r4g3_property_rental_manager.v034.updates';
  const SNAPSHOT_KEY = 'r4g3_property_rental_manager.v034.snapshot';
  const DEFAULT_SETTINGS = Object.freeze({ autoPageUpdate: false });

  function normalizeSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    return { autoPageUpdate: source.autoPageUpdate === true };
  }

  function loadSettings(storage) {
    if (!storage || typeof storage.getItem !== 'function') return normalizeSettings({});
    try {
      const raw = storage.getItem(SETTINGS_KEY);
      return normalizeSettings(raw ? JSON.parse(raw) : {});
    } catch (error) {
      return normalizeSettings({});
    }
  }

  function saveSettings(storage, next) {
    const normalized = normalizeSettings(Object.assign({}, loadSettings(storage), next || {}));
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    }
    return normalized;
  }

  function timestamp(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

  function normalizeTimestampMap(value) {
    const source = value && typeof value === 'object' ? value : {};
    const result = {};
    for (const [key, raw] of Object.entries(source)) {
      const id = Number(key);
      const time = timestamp(raw);
      if (Number.isInteger(id) && id > 0 && time) result[String(id)] = time;
    }
    return result;
  }

  function normalizeSnapshot(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.properties)) return null;
    const markets = value.markets && typeof value.markets === 'object' && !Array.isArray(value.markets)
      ? value.markets
      : {};
    const propertyMarkets = value.propertyMarkets && typeof value.propertyMarkets === 'object' && !Array.isArray(value.propertyMarkets)
      ? value.propertyMarkets
      : {};
    const legacyUpdated = normalizeTimestampMap(value.propertyUpdatedAt);
    const propertyCheckedAt = Object.prototype.hasOwnProperty.call(value, 'propertyCheckedAt')
      ? normalizeTimestampMap(value.propertyCheckedAt)
      : Object.assign({}, legacyUpdated);
    const marketCheckedAt = Object.prototype.hasOwnProperty.call(value, 'marketCheckedAt')
      ? normalizeTimestampMap(value.marketCheckedAt)
      : Object.assign({}, legacyUpdated);
    return {
      properties: value.properties,
      markets,
      propertyMarkets,
      updatedAt: timestamp(value.updatedAt),
      propertyUpdatedAt: legacyUpdated,
      propertyCheckedAt,
      marketCheckedAt
    };
  }

  function loadSnapshot(storage) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
      const raw = storage.getItem(SNAPSHOT_KEY);
      return raw ? normalizeSnapshot(JSON.parse(raw)) : null;
    } catch (error) {
      return null;
    }
  }

  function saveSnapshot(storage, next) {
    const normalized = normalizeSnapshot(next);
    if (!normalized) return null;
    if (storage && typeof storage.setItem === 'function') {
      try {
        storage.setItem(SNAPSHOT_KEY, JSON.stringify(normalized));
      } catch (error) {
        return normalized;
      }
    }
    return normalized;
  }

  return Object.freeze({
    SETTINGS_KEY,
    SNAPSHOT_KEY,
    DEFAULT_SETTINGS,
    normalizeSettings,
    loadSettings,
    saveSettings,
    normalizeSnapshot,
    loadSnapshot,
    saveSnapshot
  });
}));

/* ===== src/ui-observer.js ===== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3UiObserver = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const hubs = typeof WeakMap === 'function' ? new WeakMap() : new Map();

  function normalizeOptions(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      childList: source.childList === true,
      attributes: source.attributes === true,
      characterData: source.characterData === true,
      subtree: source.subtree === true,
      attributeOldValue: source.attributeOldValue === true,
      characterDataOldValue: source.characterDataOldValue === true,
      attributeFilter: Array.isArray(source.attributeFilter) ? source.attributeFilter.map(String) : null
    };
  }

  function recordMatches(registration, record) {
    if (!registration || !record) return false;
    const options = registration.options;
    if (record.type === 'childList' && !options.childList) return false;
    if (record.type === 'attributes' && !options.attributes) return false;
    if (record.type === 'characterData' && !options.characterData) return false;
    if (record.type === 'attributes' && options.attributeFilter && options.attributeFilter.length) {
      if (!options.attributeFilter.includes(String(record.attributeName || ''))) return false;
    }

    const target = registration.target;
    if (record.target === target) return true;
    if (!options.subtree || !target) return false;
    if (typeof target.contains === 'function') {
      try { return target.contains(record.target); } catch (error) { return false; }
    }
    return false;
  }

  function mergedNativeOptions(observers) {
    const merged = {
      childList: false,
      attributes: false,
      characterData: false,
      subtree: true,
      attributeOldValue: false,
      characterDataOldValue: false
    };
    let attributeFilter = null;
    let unrestrictedAttributes = false;
    let hasRegistration = false;

    for (const observer of observers) {
      for (const registration of observer._registrations.values()) {
        hasRegistration = true;
        const options = registration.options;
        merged.childList = merged.childList || options.childList;
        merged.attributes = merged.attributes || options.attributes;
        merged.characterData = merged.characterData || options.characterData;
        merged.attributeOldValue = merged.attributeOldValue || options.attributeOldValue;
        merged.characterDataOldValue = merged.characterDataOldValue || options.characterDataOldValue;

        if (options.attributes) {
          if (options.attributeFilter && options.attributeFilter.length) {
            if (attributeFilter === null) attributeFilter = new Set(options.attributeFilter);
            else for (const name of options.attributeFilter) attributeFilter.add(name);
          } else {
            unrestrictedAttributes = true;
          }
        }
      }
    }

    if (!hasRegistration) return null;
    if (!merged.childList && !merged.attributes && !merged.characterData) merged.childList = true;
    if (merged.attributes && !unrestrictedAttributes && attributeFilter && attributeFilter.size) {
      merged.attributeFilter = [...attributeFilter];
    }
    return merged;
  }

  function createHub(windowLike, documentLike) {
    if (!windowLike || !documentLike) throw new TypeError('window and document are required');
    if (hubs.has(documentLike)) return hubs.get(documentLike);

    const NativeMutationObserver = windowLike.MutationObserver;
    const rootTarget = documentLike.documentElement || documentLike.body || null;
    const observers = new Set();
    let nativeObserver = null;

    function dispatch(records) {
      const source = Array.isArray(records) ? records : Array.from(records || []);
      for (const observer of [...observers]) {
        if (!observer._registrations.size) continue;
        const matched = source.filter(record => {
          for (const registration of observer._registrations.values()) {
            if (recordMatches(registration, record)) return true;
          }
          return false;
        });
        if (!matched.length) continue;
        try { observer._callback(matched, observer); } catch (error) {
          const schedule = typeof windowLike.setTimeout === 'function' ? windowLike.setTimeout.bind(windowLike) : setTimeout;
          schedule(() => { throw error; }, 0);
        }
      }
    }

    function reconfigure() {
      const options = mergedNativeOptions(observers);
      if (!options || !rootTarget || typeof NativeMutationObserver !== 'function') {
        if (nativeObserver) nativeObserver.disconnect();
        return;
      }
      if (!nativeObserver) nativeObserver = new NativeMutationObserver(dispatch);
      else nativeObserver.disconnect();
      nativeObserver.observe(rootTarget, options);
    }

    class MultiplexedMutationObserver {
      constructor(callback) {
        if (typeof callback !== 'function') throw new TypeError('MutationObserver callback must be a function');
        this._callback = callback;
        this._registrations = new Map();
      }

      observe(target, options) {
        if (!target) throw new TypeError('MutationObserver target is required');
        const normalized = normalizeOptions(options);
        if (!normalized.childList && !normalized.attributes && !normalized.characterData) {
          throw new TypeError('MutationObserver options must enable childList, attributes, or characterData');
        }
        this._registrations.set(target, { target, options: normalized });
        observers.add(this);
        reconfigure();
      }

      disconnect() {
        this._registrations.clear();
        observers.delete(this);
        reconfigure();
      }

      takeRecords() {
        return [];
      }
    }

    const hub = Object.freeze({
      MutationObserver: MultiplexedMutationObserver,
      activeObserverCount() { return observers.size; },
      disconnectAll() {
        for (const observer of [...observers]) observer._registrations.clear();
        observers.clear();
        if (nativeObserver) nativeObserver.disconnect();
      }
    });
    hubs.set(documentLike, hub);
    return hub;
  }

  function createWindowProxy(windowLike, documentLike) {
    const hub = createHub(windowLike, documentLike);
    if (typeof Proxy !== 'function') {
      const fallback = Object.create(windowLike);
      fallback.MutationObserver = hub.MutationObserver;
      return fallback;
    }

    const bound = new Map();
    return new Proxy(windowLike, {
      get(target, property) {
        if (property === 'MutationObserver') return hub.MutationObserver;
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        if (!bound.has(property) || bound.get(property).source !== value) {
          bound.set(property, { source: value, value: value.bind(target) });
        }
        return bound.get(property).value;
      },
      set(target, property, value) {
        return Reflect.set(target, property, value, target);
      },
      has(target, property) {
        if (property === 'MutationObserver') return true;
        return property in target;
      }
    });
  }

  return Object.freeze({
    createHub,
    createWindowProxy
  });
}));

/* ===== src/app-runtime.js ===== */

/* --- app runtime source: src/app.js --- */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalApp = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SETTINGS_KEY = 'r4g3_property_rental_manager.settings';
  const TARGET_DAYS = 100;
  const MOBILE_BREAKPOINT = 700;
  const DEFAULT_SETTINGS = Object.freeze({
    apiKey: '',
    theme: 'dark',
    undercutPercent: 0.5,
    days: TARGET_DAYS,
    uiState: 'open',
    geometry: Object.freeze({ left: 32, top: 90, width: 920, height: 560 })
  });

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function integer(value, min, max, fallback) {
    return Math.round(clamp(value, min, max, fallback));
  }

  function normalizeGeometry(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      left: integer(source.left, 0, 10000, DEFAULT_SETTINGS.geometry.left),
      top: integer(source.top, 0, 10000, DEFAULT_SETTINGS.geometry.top),
      width: integer(source.width, 360, 3000, DEFAULT_SETTINGS.geometry.width),
      height: integer(source.height, 260, 2400, DEFAULT_SETTINGS.geometry.height)
    };
  }

  function normalizeUiState(value) {
    return value === 'closed' || value === 'minimized' ? value : 'open';
  }

  function normalizeSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      apiKey: typeof source.apiKey === 'string' ? source.apiKey.trim() : DEFAULT_SETTINGS.apiKey,
      theme: source.theme === 'light' ? 'light' : 'dark',
      undercutPercent: clamp(source.undercutPercent, 0, 25, DEFAULT_SETTINGS.undercutPercent),
      days: TARGET_DAYS,
      uiState: normalizeUiState(source.uiState),
      geometry: normalizeGeometry(source.geometry)
    };
  }

  function loadSettings(storage) {
    if (!storage || typeof storage.getItem !== 'function') return normalizeSettings({});
    try {
      const raw = storage.getItem(SETTINGS_KEY);
      return normalizeSettings(raw ? JSON.parse(raw) : {});
    } catch (error) {
      return normalizeSettings({});
    }
  }

  function saveSettings(storage, next) {
    const current = loadSettings(storage);
    const source = next && typeof next === 'object' ? next : {};
    const normalized = normalizeSettings(Object.assign({}, current, source, {
      geometry: source.geometry ? source.geometry : current.geometry
    }));
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    }
    return normalized;
  }

  function money(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'n/a';
    return Math.floor(number).toLocaleString('en-US');
  }

  function labelStatus(status) {
    const text = String(status || 'unknown').replace(/_/g, ' ').trim();
    return text ? text.replace(/\b\w/g, char => char.toUpperCase()) : 'Unknown';
  }

  function el(documentLike, tag, options) {
    const node = documentLike.createElement(tag);
    const config = options || {};
    if (config.className) node.className = config.className;
    if (config.text != null) node.textContent = String(config.text);
    if (config.attrs) {
      for (const [name, value] of Object.entries(config.attrs)) {
        node.setAttribute(name, String(value));
      }
    }
    return node;
  }

  function createController(options) {
    const config = options || {};
    const windowLike = config.window;
    const documentLike = config.document;
    const storage = config.storage || windowLike && windowLike.localStorage;
    const fixedApiClient = config.apiClient || null;
    const apiClientFactory = typeof config.apiClientFactory === 'function' ? config.apiClientFactory : null;
    const propertyCore = config.propertyCore;
    const marketCore = config.marketCore;
    const draftStore = config.draftStore;
    const navigate = typeof config.navigate === 'function'
      ? config.navigate
      : url => { if (windowLike && windowLike.location) windowLike.location.href = url; };
    const canListProperty = typeof config.canListProperty === 'function'
      ? config.canListProperty
      : () => false;
    const listProperty = typeof config.listProperty === 'function'
      ? config.listProperty
      : () => ({ submitted: false, reason: 'Listing action unavailable' });

    if (!windowLike || !documentLike) throw new TypeError('window and document are required');
    if (!fixedApiClient && !apiClientFactory) throw new TypeError('apiClient or apiClientFactory is required');
    if (fixedApiClient && (typeof fixedApiClient.fetchOwnedProperties !== 'function' || typeof fixedApiClient.scanMarkets !== 'function')) {
      throw new TypeError('apiClient is invalid');
    }
    if (!propertyCore || !marketCore || !draftStore) throw new TypeError('Core dependencies are required');

    let settings = loadSettings(storage);
    let state = {
      properties: [],
      markets: {},
      propertyMarkets: {},
      rows: [],
      loading: false,
      error: null,
      needsApiKey: false,
      actionMessage: '',
      scanProgress: null
    };
    let panel = null;
    let dragCleanup = null;
    let resizeCleanup = null;
    let resizeObserver = null;
    let settingsOpen = false;
    let cachedApiClient = null;
    let cachedApiKey = '';
    let activeLoadPromise = null;

    function isMobile() {
      return Number(windowLike.innerWidth) <= MOBILE_BREAKPOINT;
    }

    function persistSettings(patch) {
      settings = saveSettings(storage, Object.assign({}, settings, patch || {}));
      return settings;
    }

    function getApiClient() {
      if (apiClientFactory) {
        if (!settings.apiKey) return null;
        if (cachedApiClient && cachedApiKey === settings.apiKey) return cachedApiClient;
        const client = apiClientFactory(settings.apiKey);
        if (!client || typeof client.fetchOwnedProperties !== 'function' || typeof client.scanMarkets !== 'function') {
          throw new TypeError('apiClientFactory returned an invalid client');
        }
        cachedApiClient = client;
        cachedApiKey = settings.apiKey;
        return client;
      }
      return fixedApiClient;
    }

    function computeRows(properties, markets, propertyMarkets) {
      const perProperty = propertyMarkets && typeof propertyMarkets === 'object' ? propertyMarkets : {};
      return properties.map(property => {
        const propertyMarket = perProperty[property.id] || perProperty[String(property.id)];
        const market = propertyMarket || markets && markets[property.propertyTypeId];
        const quote = marketCore.rentalQuote(
          property,
          market && Array.isArray(market.rentals) ? market.rentals : [],
          {
            targetDays: TARGET_DAYS,
            undercutPercent: settings.undercutPercent
          }
        );
        return { property, market: market || null, quote };
      }).sort((a, b) => {
        const aEligible = propertyCore.isEligibleForLease(a.property) ? 1 : 0;
        const bEligible = propertyCore.isEligibleForLease(b.property) ? 1 : 0;
        if (aEligible !== bEligible) return bEligible - aEligible;
        return String(a.property.name || '').localeCompare(String(b.property.name || '')) || Number(a.property.id) - Number(b.property.id);
      });
    }

    function applyPanelGeometry(node) {
      node.style.position = 'fixed';
      node.style.overflow = settings.uiState === 'minimized' ? 'hidden' : 'auto';
      node.style.zIndex = '99999';
      node.style.maxWidth = 'calc(100vw - 16px)';
      node.style.maxHeight = 'calc(100vh - 16px)';

      if (isMobile()) {
        node.style.left = '8px';
        node.style.top = '8px';
        node.style.width = 'calc(100vw - 16px)';
        node.style.height = settings.uiState === 'minimized' ? 'auto' : 'calc(100vh - 16px)';
        node.style.resize = 'none';
        return;
      }

      const geometry = settings.geometry;
      node.style.left = `${geometry.left}px`;
      node.style.top = `${geometry.top}px`;
      node.style.width = `${geometry.width}px`;
      node.style.height = settings.uiState === 'minimized' ? 'auto' : `${geometry.height}px`;
      node.style.resize = settings.uiState === 'minimized' ? 'none' : 'both';
    }

    function addStyles(node) {
      node.style.boxSizing = 'border-box';
      node.style.border = '1px solid rgba(90, 255, 120, 0.35)';
      node.style.borderRadius = '10px';
      node.style.boxShadow = '0 12px 34px rgba(0, 0, 0, 0.35)';
      node.style.fontFamily = 'Arial, sans-serif';
      node.style.fontSize = '13px';
      node.style.padding = '0';
      node.style.background = settings.theme === 'light' ? '#f5f5f2' : '#111512';
      node.style.color = settings.theme === 'light' ? '#171917' : '#ecf4ed';
    }

    function createButton(text, action, title) {
      const button = el(documentLike, 'button', { text, attrs: { type: 'button', 'data-action': action } });
      button.style.cursor = 'pointer';
      button.style.padding = '7px 10px';
      button.style.borderRadius = '6px';
      button.style.border = '1px solid currentColor';
      button.style.background = 'transparent';
      button.style.color = 'inherit';
      if (title) button.title = title;
      return button;
    }

    function renderHeader(container) {
      const header = el(documentLike, 'div', { className: 'r4g3-prm-header' });
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.flexWrap = 'wrap';
      header.style.gap = '8px';
      header.style.padding = '9px 10px';
      header.style.borderBottom = settings.uiState === 'minimized' ? '0' : '1px solid rgba(128,128,128,0.35)';
      header.style.position = 'sticky';
      header.style.top = '0';
      header.style.background = settings.theme === 'light' ? '#f5f5f2' : '#111512';
      header.style.zIndex = '2';

      const dragHandle = el(documentLike, 'strong', {
        text: 'Property Rental Manager',
        attrs: { 'data-role': 'drag-handle' }
      });
      dragHandle.style.cursor = isMobile() ? 'default' : 'move';
      dragHandle.style.userSelect = 'none';
      dragHandle.style.marginRight = 'auto';
      dragHandle.style.color = settings.theme === 'light' ? '#102513' : '#74ff8b';
      header.appendChild(dragHandle);

      if (settings.uiState !== 'minimized') {
        const refreshButton = createButton(state.loading ? 'Scanning…' : 'Refresh', 'refresh', 'Refresh properties and use fresh cached market data when available');
        refreshButton.disabled = Boolean(state.loading);
        const settingsButton = createButton(settingsOpen ? 'Close Settings' : 'Settings', 'toggle-settings');
        const themeButton = createButton(settings.theme === 'dark' ? 'Light' : 'Dark', 'toggle-theme');
        header.append(refreshButton, settingsButton, themeButton);
      }

      header.appendChild(createButton(settings.uiState === 'minimized' ? '□' : '—', 'minimize', settings.uiState === 'minimized' ? 'Restore' : 'Minimize'));
      header.appendChild(createButton('×', 'close', 'Close'));
      container.appendChild(header);
    }

    function renderSettings(container) {
      if (!settingsOpen || settings.uiState === 'minimized') return;
      const box = el(documentLike, 'section', { className: 'r4g3-prm-settings' });
      box.style.padding = '10px';
      box.style.margin = '8px';
      box.style.border = '1px solid rgba(128,128,128,0.35)';
      box.style.borderRadius = '8px';
      box.style.display = 'grid';
      box.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
      box.style.gap = '10px';

      const keyWrap = el(documentLike, 'label', { text: settings.apiKey ? 'Torn API key (saved): ' : 'Torn API key: ' });
      const keyInput = el(documentLike, 'input', {
        attrs: {
          type: 'password',
          'data-role': 'api-key-input',
          autocomplete: 'off',
          placeholder: settings.apiKey ? 'Enter replacement key' : 'Limited-or-higher API key'
        }
      });
      keyInput.value = '';
      keyWrap.appendChild(keyInput);
      box.appendChild(keyWrap);

      const period = el(documentLike, 'div', { text: `Rental period: ${TARGET_DAYS} days` });
      box.appendChild(period);

      const undercutWrap = el(documentLike, 'label', { text: 'Average undercut %: ' });
      const undercutInput = el(documentLike, 'input', {
        attrs: { type: 'number', min: '0', max: '25', step: '0.1', 'data-role': 'undercut-input' }
      });
      undercutInput.value = String(settings.undercutPercent);
      undercutWrap.appendChild(undercutInput);
      box.appendChild(undercutWrap);

      const actions = el(documentLike, 'div');
      actions.style.gridColumn = '1 / -1';
      actions.style.display = 'flex';
      actions.style.flexWrap = 'wrap';
      actions.style.gap = '8px';
      actions.appendChild(createButton('Save Settings', 'save-settings'));
      actions.appendChild(createButton('Force Market Refresh', 'force-refresh', 'Bypass cached Torn rental-market data for all property types'));
      if (settings.apiKey) actions.appendChild(createButton('Clear API Key', 'clear-api-key'));
      box.appendChild(actions);

      const note = el(documentLike, 'small', {
        text: 'Market rentals are normalized to a 100-day total before averaging. Normal Refresh reuses fresh Torn market cache; Force Market Refresh bypasses it.'
      });
      note.style.gridColumn = '1 / -1';
      note.style.opacity = '0.72';
      box.appendChild(note);
      container.appendChild(box);
    }

    function addCell(row, label, value, emphasized) {
      const cell = el(documentLike, 'div');
      const heading = el(documentLike, 'span', { text: `${label}: ` });
      heading.style.opacity = '0.68';
      cell.appendChild(heading);
      const valueNode = el(documentLike, emphasized ? 'strong' : 'span', { text: value });
      if (emphasized) valueNode.style.color = settings.theme === 'light' ? '#0d5c19' : '#74ff8b';
      cell.appendChild(valueNode);
      row.appendChild(cell);
      return cell;
    }

    function renderRow(entry, container) {
      const { property, quote, market } = entry;
      const row = el(documentLike, 'section', {
        className: 'r4g3-prm-property',
        attrs: { 'data-property-id': property.id }
      });
      row.style.padding = '12px';
      row.style.margin = '8px';
      row.style.border = '1px solid rgba(128,128,128,0.28)';
      row.style.borderRadius = '8px';
      row.style.display = 'grid';
      row.style.gridTemplateColumns = 'repeat(auto-fit, minmax(175px, 1fr))';
      row.style.gap = '8px 14px';

      const identity = el(documentLike, 'div');
      identity.style.gridColumn = '1 / -1';
      identity.style.display = 'flex';
      identity.style.alignItems = 'center';
      identity.style.gap = '12px';
      identity.style.minWidth = '0';

      const imageUrl = typeof propertyCore.propertyImageUrl === 'function' ? propertyCore.propertyImageUrl(property.name) : '';
      if (imageUrl) {
        const image = el(documentLike, 'img', {
          attrs: {
            src: imageUrl,
            alt: `${property.name} property`,
            'data-role': 'property-image'
          }
        });
        image.style.width = '112px';
        image.style.height = '74px';
        image.style.objectFit = 'cover';
        image.style.borderRadius = '7px';
        image.style.border = '1px solid rgba(128,128,128,0.3)';
        image.style.flex = '0 0 auto';
        image.loading = 'lazy';
        image.addEventListener('error', () => { image.style.display = 'none'; }, { once: true });
        identity.appendChild(image);
      }

      const title = el(documentLike, 'strong', { text: `${property.name} #${property.id}` });
      title.style.fontSize = '14px';
      identity.appendChild(title);
      row.appendChild(identity);

      addCell(row, 'Status', labelStatus(property.status));
      addCell(row, 'Happy', money(property.happy));
      addCell(row, 'Upgrades', property.modifications && property.modifications.length ? property.modifications.join(', ') : 'None');

      if (market && market.error) {
        const failed = el(documentLike, 'div', { text: `Market scan failed for this property type: ${market.error}` });
        failed.style.gridColumn = '1 / -1';
        row.appendChild(failed);
        const retry = createButton('RETRY MARKET', 'retry-market');
        retry.dataset.propertyTypeId = String(property.propertyTypeId);
        row.appendChild(retry);
      } else if (!market && state.loading) {
        const pending = el(documentLike, 'div', { text: 'Market scan pending…' });
        pending.style.gridColumn = '1 / -1';
        pending.style.opacity = '0.72';
        row.appendChild(pending);
      } else if (quote.exactMatchCount > 0) {
        addCell(row, 'Exact matches', quote.exactMatchCount);
        addCell(row, 'Lowest 100-day', `$${money(quote.lowestTotal)}`);
        addCell(row, 'Highest 100-day', `$${money(quote.highestTotal)}`);
        addCell(row, 'Average 100-day', `$${money(quote.averageTotal)}`);
        addCell(row, 'Proposed 100-day rent', `$${money(quote.proposedTotal)}`, true);
        addCell(row, 'Market source', market && market.fromCache ? 'Cached' : 'Live');
      } else {
        const noMatches = el(documentLike, 'div', { text: 'No exact market matches for this upgrade configuration.' });
        noMatches.style.gridColumn = '1 / -1';
        noMatches.style.opacity = '0.78';
        row.appendChild(noMatches);
      }

      if (propertyCore.isEligibleForLease(property) && quote.proposedTotal != null) {
        const actions = el(documentLike, 'div');
        actions.style.gridColumn = '1 / -1';
        actions.style.display = 'flex';
        actions.style.flexWrap = 'wrap';
        actions.style.gap = '8px';

        const setPrice = createButton('SET PRICE', 'set-price');
        setPrice.dataset.propertyId = String(property.id);
        setPrice.style.color = settings.theme === 'light' ? '#0d5c19' : '#74ff8b';

        const list = createButton('LIST PROPERTY', 'list-property');
        list.dataset.propertyId = String(property.id);
        list.disabled = !canListProperty(property.id);
        list.style.opacity = list.disabled ? '0.45' : '1';
        list.title = list.disabled
          ? 'Press SET PRICE first, then list from the prepared Torn lease page.'
          : `List this property for $${money(quote.proposedTotal)} over ${TARGET_DAYS} days`;

        actions.append(setPrice, list);
        row.appendChild(actions);
      }

      container.appendChild(row);
    }

    function renderStatus(container) {
      if (state.actionMessage) {
        const message = el(documentLike, 'div', { text: state.actionMessage });
        message.style.padding = '8px 12px';
        message.style.borderBottom = '1px solid rgba(128,128,128,0.25)';
        container.appendChild(message);
      }
      if (state.needsApiKey) {
        const keyMessage = el(documentLike, 'div', {
          text: 'A Limited-or-higher Torn API key is required. Open Settings to configure it.'
        });
        keyMessage.style.padding = '14px';
        container.appendChild(keyMessage);
        return true;
      }
      if (state.loading) {
        const progress = state.scanProgress && state.scanProgress.total
          ? `Scanning rental markets… ${state.scanProgress.done}/${state.scanProgress.total}`
          : 'Scanning owned properties and rental markets…';
        const loading = el(documentLike, 'div', { text: progress });
        loading.style.padding = '10px 14px';
        loading.style.borderBottom = '1px solid rgba(128,128,128,0.2)';
        container.appendChild(loading);
        return !state.rows.length;
      }
      if (state.error) {
        const error = el(documentLike, 'div', { text: 'Unable to load property data. Check your Torn API key and try again.' });
        error.style.padding = '14px';
        container.appendChild(error);
        return true;
      }
      if (!state.rows.length) {
        const empty = el(documentLike, 'div', { text: 'No owned properties were returned.' });
        empty.style.padding = '14px';
        container.appendChild(empty);
        return true;
      }
      return false;
    }

    function readSettingsFields(node) {
      const keyInput = node.querySelector('[data-role="api-key-input"]');
      const undercutInput = node.querySelector('[data-role="undercut-input"]');
      return {
        apiKey: keyInput && keyInput.value ? keyInput.value.trim() : null,
        undercutPercent: undercutInput ? undercutInput.value : settings.undercutPercent
      };
    }

    function setPriceForProperty(propertyId) {
      const id = Number(propertyId);
      const entry = state.rows.find(row => row.property.id === id);
      if (!entry || !propertyCore.isEligibleForLease(entry.property) || entry.quote.proposedTotal == null) return false;

      draftStore.save({
        propertyId: id,
        days: TARGET_DAYS,
        totalCost: entry.quote.proposedTotal,
        dailyPrice: Math.max(1, Math.floor(entry.quote.proposedTotal / TARGET_DAYS))
      });
      navigate(propertyCore.leaseUrl(id));
      return true;
    }

    function listPreparedProperty(propertyId) {
      const id = Number(propertyId);
      const entry = state.rows.find(row => row.property.id === id);
      if (!entry || !propertyCore.isEligibleForLease(entry.property) || entry.quote.proposedTotal == null) return false;
      if (!canListProperty(id)) return false;

      const result = listProperty(id);
      if (result && result.submitted) {
        state = Object.assign({}, state, { actionMessage: `Listing submitted for ${entry.property.name} #${id}.` });
        render();
      }
      return result || false;
    }

    async function retryMarket(propertyTypeId) {
      const id = Number(propertyTypeId);
      const apiClient = getApiClient();
      if (!apiClient || typeof apiClient.fetchRentalMarket !== 'function' || !id) return false;
      state = Object.assign({}, state, { actionMessage: `Retrying market ${id}…` });
      render();
      try {
        const market = await apiClient.fetchRentalMarket(id, { force: true });
        const markets = Object.assign({}, state.markets, { [id]: market });
        state = Object.assign({}, state, {
          markets,
          rows: computeRows(state.properties, markets, state.propertyMarkets),
          actionMessage: `Market ${id} refreshed.`
        });
        render();
        return true;
      } catch (error) {
        const markets = Object.assign({}, state.markets, {
          [id]: { rentals: [], error: String(error && error.message || error) }
        });
        state = Object.assign({}, state, { markets, rows: computeRows(state.properties, markets, state.propertyMarkets), actionMessage: `Market ${id} retry failed.` });
        render();
        return false;
      }
    }

    function closePanel() {
      persistGeometryFromPanel();
      persistSettings({ uiState: 'closed' });
      render();
      return true;
    }

    function toggleMinimize() {
      if (settings.uiState === 'minimized') persistSettings({ uiState: 'open' });
      else {
        persistGeometryFromPanel();
        persistSettings({ uiState: 'minimized' });
      }
      render();
      return settings.uiState;
    }

    function open() {
      persistSettings({ uiState: 'open' });
      render();
      return true;
    }

    function attachPanelEvents(node) {
      node.addEventListener('click', event => {
        const button = event.target && event.target.closest && event.target.closest('[data-action]');
        if (!button || !node.contains(button)) return;
        const action = button.dataset.action;
        if (action === 'refresh') {
          load({ force: false }).catch(() => {});
          return;
        }
        if (action === 'force-refresh') {
          load({ force: true }).catch(() => {});
          return;
        }
        if (action === 'retry-market') {
          retryMarket(Number(button.dataset.propertyTypeId)).catch(() => {});
          return;
        }
        if (action === 'minimize') {
          toggleMinimize();
          return;
        }
        if (action === 'close') {
          closePanel();
          return;
        }
        if (action === 'toggle-theme') {
          setTheme(settings.theme === 'dark' ? 'light' : 'dark');
          return;
        }
        if (action === 'toggle-settings') {
          settingsOpen = !settingsOpen;
          render();
          return;
        }
        if (action === 'save-settings') {
          const fields = readSettingsFields(node);
          const patch = { undercutPercent: fields.undercutPercent };
          if (fields.apiKey) patch.apiKey = fields.apiKey;
          persistSettings(patch);
          state.rows = computeRows(state.properties, state.markets, state.propertyMarkets);
          render();
          return;
        }
        if (action === 'clear-api-key') {
          setApiKey('');
          return;
        }
        if (action === 'set-price') {
          setPriceForProperty(Number(button.dataset.propertyId));
          return;
        }
        if (action === 'list-property') {
          listPreparedProperty(Number(button.dataset.propertyId));
        }
      });
    }

    function attachDrag(node) {
      if (isMobile()) return;
      const handle = node.querySelector('[data-role="drag-handle"]');
      if (!handle) return;
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let originLeft = 0;
      let originTop = 0;

      const onMove = event => {
        if (!dragging) return;
        node.style.left = `${Math.max(0, originLeft + event.clientX - startX)}px`;
        node.style.top = `${Math.max(0, originTop + event.clientY - startY)}px`;
      };
      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        persistGeometryFromPanel();
      };
      const onDown = event => {
        if (event.button != null && event.button !== 0) return;
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        originLeft = parseInt(node.style.left, 10) || 0;
        originTop = parseInt(node.style.top, 10) || 0;
        if (typeof event.preventDefault === 'function') event.preventDefault();
      };

      handle.addEventListener('mousedown', onDown);
      windowLike.addEventListener('mousemove', onMove);
      windowLike.addEventListener('mouseup', onUp);
      dragCleanup = () => {
        handle.removeEventListener('mousedown', onDown);
        windowLike.removeEventListener('mousemove', onMove);
        windowLike.removeEventListener('mouseup', onUp);
      };
    }

    function persistGeometryFromPanel() {
      if (!panel || isMobile() || settings.uiState === 'minimized') return;
      const geometry = {
        left: parseInt(panel.style.left, 10) || 0,
        top: parseInt(panel.style.top, 10) || 0,
        width: panel.offsetWidth || parseInt(panel.style.width, 10) || settings.geometry.width,
        height: panel.offsetHeight || parseInt(panel.style.height, 10) || settings.geometry.height
      };
      persistSettings({ geometry });
    }

    function attachResize(node) {
      if (isMobile() || settings.uiState === 'minimized') return;
      if (windowLike.ResizeObserver) {
        resizeObserver = new windowLike.ResizeObserver(() => persistGeometryFromPanel());
        resizeObserver.observe(node);
      }
    }

    function renderResizeHandle(container) {
      if (isMobile() || settings.uiState === 'minimized') return;
      const handle = el(documentLike, 'div', {
        attrs: {
          'data-role': 'resize-handle',
          title: 'Drag to resize Property Rental Manager',
          'aria-label': 'Resize Property Rental Manager'
        }
      });
      handle.style.position = 'absolute';
      handle.style.right = '1px';
      handle.style.bottom = '1px';
      handle.style.width = '20px';
      handle.style.height = '20px';
      handle.style.cursor = 'nwse-resize';
      handle.style.zIndex = '4';
      handle.style.borderRight = settings.theme === 'light' ? '3px solid #0d5c19' : '3px solid #74ff8b';
      handle.style.borderBottom = settings.theme === 'light' ? '3px solid #0d5c19' : '3px solid #74ff8b';
      handle.style.borderRadius = '0 0 8px 0';
      handle.style.boxSizing = 'border-box';
      container.appendChild(handle);
    }

    function attachExplicitResize(node) {
      if (isMobile() || settings.uiState === 'minimized') return;
      const handle = node.querySelector('[data-role="resize-handle"]');
      if (!handle) return;
      let resizing = false;
      let startX = 0;
      let startY = 0;
      let originWidth = 0;
      let originHeight = 0;

      const onMove = event => {
        if (!resizing) return;
        const width = integer(originWidth + event.clientX - startX, 360, 3000, originWidth);
        const height = integer(originHeight + event.clientY - startY, 260, 2400, originHeight);
        node.style.width = `${width}px`;
        node.style.height = `${height}px`;
      };
      const onUp = () => {
        if (!resizing) return;
        resizing = false;
        persistGeometryFromPanel();
      };
      const onDown = event => {
        if (event.button != null && event.button !== 0) return;
        resizing = true;
        startX = event.clientX;
        startY = event.clientY;
        originWidth = node.offsetWidth || parseInt(node.style.width, 10) || settings.geometry.width;
        originHeight = node.offsetHeight || parseInt(node.style.height, 10) || settings.geometry.height;
        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
      };

      handle.addEventListener('mousedown', onDown);
      windowLike.addEventListener('mousemove', onMove);
      windowLike.addEventListener('mouseup', onUp);
      resizeCleanup = () => {
        handle.removeEventListener('mousedown', onDown);
        windowLike.removeEventListener('mousemove', onMove);
        windowLike.removeEventListener('mouseup', onUp);
      };
    }

    function render() {
      if (dragCleanup) {
        dragCleanup();
        dragCleanup = null;
      }
      if (resizeCleanup) {
        resizeCleanup();
        resizeCleanup = null;
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (panel && panel.parentNode) panel.remove();
      panel = null;

      if (settings.uiState === 'closed') return null;

      panel = el(documentLike, 'aside', { attrs: { id: 'r4g3-prm-panel' } });
      panel.className = `r4g3-prm-theme-${settings.theme}`;
      applyPanelGeometry(panel);
      addStyles(panel);
      renderHeader(panel);

      if (settings.uiState !== 'minimized') {
        renderSettings(panel);
        if (!renderStatus(panel)) {
          for (const row of state.rows) renderRow(row, panel);
        }
        renderResizeHandle(panel);
      }

      documentLike.body.appendChild(panel);
      attachPanelEvents(panel);
      attachDrag(panel);
      attachResize(panel);
      attachExplicitResize(panel);
      return panel;
    }

    async function performLoad(options) {
      if (apiClientFactory && !settings.apiKey) {
        settingsOpen = true;
        state = {
          properties: [],
          markets: {},
          propertyMarkets: {},
          rows: [],
          loading: false,
          error: null,
          needsApiKey: true,
          actionMessage: '',
          scanProgress: null
        };
        render();
        return state;
      }

      const apiClient = getApiClient();
      state = Object.assign({}, state, { loading: true, error: null, needsApiKey: false, actionMessage: '', scanProgress: null });
      render();
      try {
        const currentUserId = typeof apiClient.fetchCurrentUserId === 'function'
          ? await apiClient.fetchCurrentUserId()
          : null;
        const rawProperties = await apiClient.fetchOwnedProperties();
        const properties = propertyCore.normalizeProperties(rawProperties, currentUserId);
        const typeIds = [...new Set(properties.map(property => Number(property.propertyTypeId)).filter(Boolean))];
        state = Object.assign({}, state, {
          properties,
          markets: {},
          propertyMarkets: {},
          rows: computeRows(properties, {}, {}),
          scanProgress: { done: 0, total: typeIds.length }
        });
        render();

        const markets = await apiClient.scanMarkets(properties, {
          force: Boolean(options && options.force),
          onProgress(entry) {
            const nextMarkets = Object.assign({}, state.markets, { [entry.id]: entry.market });
            state = Object.assign({}, state, {
              markets: nextMarkets,
              propertyMarkets: {},
              rows: computeRows(properties, nextMarkets, {}),
              scanProgress: { done: entry.done, total: entry.total }
            });
            render();
          }
        });
        const propertyMarkets = {};
        const rows = computeRows(properties, markets, propertyMarkets);
        state = { properties, markets, propertyMarkets, rows, loading: false, error: null, needsApiKey: false, actionMessage: '', scanProgress: null };
        render();
        return state;
      } catch (error) {
        state = Object.assign({}, state, { loading: false, error: error || new Error('Unknown load failure'), needsApiKey: false, scanProgress: null });
        render();
        throw error;
      }
    }

    function load(options) {
      if (activeLoadPromise) return activeLoadPromise;
      activeLoadPromise = performLoad(options).finally(() => {
        activeLoadPromise = null;
      });
      return activeLoadPromise;
    }

    function hydrate(snapshot) {
      const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
      const properties = Array.isArray(source.properties) ? source.properties.slice() : [];
      const markets = source.markets && typeof source.markets === 'object' && !Array.isArray(source.markets)
        ? Object.assign({}, source.markets)
        : {};
      const propertyMarkets = source.propertyMarkets && typeof source.propertyMarkets === 'object' && !Array.isArray(source.propertyMarkets)
        ? Object.assign({}, source.propertyMarkets)
        : {};
      state = {
        properties,
        markets,
        propertyMarkets,
        rows: computeRows(properties, markets, propertyMarkets),
        loading: false,
        error: null,
        needsApiKey: false,
        actionMessage: '',
        scanProgress: null
      };
      render();
      return state;
    }

    async function updateProperty(propertyId, options) {
      const id = Number(propertyId);
      const updateOptions = options || {};
      const silent = updateOptions.silent === true;
      const onProgress = typeof updateOptions.onProgress === 'function' ? updateOptions.onProgress : null;
      const progress = value => {
        if (!onProgress) return;
        try { onProgress(Object.assign({ propertyId: id }, value || {})); } catch (error) { /* UI progress must never break an update. */ }
      };
      if (!Number.isInteger(id) || id <= 0) throw new TypeError('A positive property ID is required');
      if (apiClientFactory && !settings.apiKey) {
        settingsOpen = true;
        state = Object.assign({}, state, { needsApiKey: true, error: null });
        if (!silent) render();
        return state;
      }
      const apiClient = getApiClient();
      state = Object.assign({}, state, { error: null, needsApiKey: false, actionMessage: `Updating property ${id}…` });
      progress({ phase: 'property', percent: 5, label: 'Checking property status…' });
      if (!silent) render();
      try {
        const currentUserId = typeof apiClient.fetchCurrentUserId === 'function'
          ? await apiClient.fetchCurrentUserId()
          : null;
        progress({ phase: 'property', percent: 20, label: 'Loading current property state…' });
        const rawProperties = await apiClient.fetchOwnedProperties();
        const freshProperties = propertyCore.normalizeProperties(rawProperties, currentUserId);
        const fresh = freshProperties.find(property => Number(property.id) === id);
        if (!fresh) throw new Error('Property is no longer present in the verified owned-property list');

        let replaced = false;
        const properties = (state.properties || []).map(property => {
          if (Number(property.id) !== id) return property;
          replaced = true;
          return fresh;
        });
        if (!replaced) properties.push(fresh);

        progress({ phase: 'market', percent: 35, label: 'Searching rental market…' });
        const scanned = await apiClient.scanMarkets([fresh], {
          force: Boolean(updateOptions.force),
          onProgress(entry) {
            const total = Math.max(1, Number(entry && entry.total) || 1);
            const done = Math.max(0, Number(entry && entry.done) || 0);
            const percent = Math.min(92, Math.round(35 + (done / total) * 57));
            progress({ phase: 'market', percent, label: 'Searching rental market…', done, total });
          }
        });
        const selectedMarket = scanned && scanned[fresh.propertyTypeId] || null;
        const markets = Object.assign({}, state.markets || {});
        const propertyMarkets = Object.assign({}, state.propertyMarkets || {}, { [String(id)]: selectedMarket });
        state = Object.assign({}, state, {
          properties,
          markets,
          propertyMarkets,
          rows: computeRows(properties, markets, propertyMarkets),
          loading: false,
          error: null,
          needsApiKey: false,
          actionMessage: `Property ${id} updated.`,
          scanProgress: null
        });
        progress({ phase: 'complete', percent: 100, label: 'Update complete.' });
        if (!silent) render();
        return state;
      } catch (error) {
        state = Object.assign({}, state, { error, actionMessage: `Property ${id} update failed.` });
        progress({ phase: 'error', percent: 100, label: 'Update failed.' });
        if (!silent) render();
        throw error;
      }
    }

    function setTheme(theme) {
      persistSettings({ theme });
      render();
      return settings.theme;
    }

    function setMode() {
      return 'simple';
    }

    function openSettings() {
      if (settings.uiState === 'closed' || settings.uiState === 'minimized') persistSettings({ uiState: 'open' });
      settingsOpen = true;
      render();
      return true;
    }

    function setApiKey(apiKey) {
      persistSettings({ apiKey: String(apiKey || '').trim() });
      if (cachedApiKey !== settings.apiKey) {
        cachedApiClient = null;
        cachedApiKey = '';
      }
      state = Object.assign({}, state, { needsApiKey: apiClientFactory ? !settings.apiKey : false, error: null });
      settingsOpen = true;
      render();
      return Boolean(settings.apiKey);
    }

    function destroy() {
      if (dragCleanup) dragCleanup();
      if (resizeCleanup) resizeCleanup();
      if (resizeObserver) resizeObserver.disconnect();
      if (panel && panel.parentNode) panel.remove();
      panel = null;
    }

    render();

    return Object.freeze({
      load,
      hydrate,
      updateProperty,
      render,
      open,
      close: closePanel,
      toggleMinimize,
      retryMarket,
      setPriceForProperty,
      listPreparedProperty,
      prepareLease: setPriceForProperty,
      setMode,
      setTheme,
      openSettings,
      setApiKey,
      destroy,
      getState: () => state,
      getSettings: () => Object.assign({}, settings, { geometry: Object.assign({}, settings.geometry) })
    });
  }

  return Object.freeze({
    SETTINGS_KEY,
    TARGET_DAYS,
    DEFAULT_SETTINGS,
    normalizeSettings,
    loadSettings,
    saveSettings,
    createController
  });
}));

/* --- app runtime source: src/app-v033.js --- */
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
        title.textContent = 'Property Rental Manager';
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

/* --- app runtime source: src/app-v034.js --- */
(function (root, factory) {
  const baseApp = typeof module === 'object' && module.exports ? require('./app-v033') : root.R4G3PropertyRentalApp;
  const updateCore = typeof module === 'object' && module.exports ? require('./update-core-v034') : root.R4G3UpdateCoreV034;
  const api = factory(baseApp, updateCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalApp = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (baseApp, updateCore) {
  'use strict';

  if (!baseApp || !updateCore) throw new Error('v0.3.4 app dependencies are unavailable');

  function createController(options) {
    const config = options || {};
    const windowLike = config.window;
    const documentLike = config.document;
    const storage = config.storage || windowLike && windowLike.localStorage;
    const prepareCancelProperty = typeof config.prepareCancelProperty === 'function'
      ? config.prepareCancelProperty
      : () => ({ prepared: false, reason: 'Cancellation preparation unavailable' });
    const canCancelProperty = typeof config.canCancelProperty === 'function'
      ? config.canCancelProperty
      : () => false;
    const cancelProperty = typeof config.cancelProperty === 'function'
      ? config.cancelProperty
      : () => ({ submitted: false, reason: 'Cancellation unavailable' });
    const hasCancelConfirmationBridge = typeof config.canConfirmCancelProperty === 'function' && typeof config.confirmCancelProperty === 'function';
    const canConfirmCancelProperty = typeof config.canConfirmCancelProperty === 'function'
      ? config.canConfirmCancelProperty
      : () => false;
    const confirmCancelProperty = typeof config.confirmCancelProperty === 'function'
      ? config.confirmCancelProperty
      : () => ({ submitted: false, reason: 'Cancellation confirmation unavailable' });

    if (!windowLike || !documentLike) throw new TypeError('window and document are required');

    const baseController = baseApp.createController(config);
    let updateSettings = updateCore.loadSettings(storage);
    const savedSnapshot = updateCore.loadSnapshot(storage);
    let updatedAt = savedSnapshot && Number(savedSnapshot.updatedAt) || 0;
    const propertyUpdatedAt = Object.assign({}, savedSnapshot && savedSnapshot.propertyUpdatedAt || {});
    const updatingProperties = new Set();
    const updateProgress = new Map();
    const cancellationSent = new Set();
    let updatingAll = false;
    let pendingCancelId = null;
    let pendingCancelStage = 'idle';
    let uiObserver = null;
    let observerScheduled = false;
    let destroyed = false;

    if (savedSnapshot && typeof baseController.hydrate === 'function') {
      baseController.hydrate({
        properties: savedSnapshot.properties,
        markets: savedSnapshot.markets,
        propertyMarkets: savedSnapshot.propertyMarkets
      });
      baseController.render();
    }

    function now() {
      return Date.now();
    }

    function saveCurrentSnapshot() {
      const state = baseController.getState();
      return updateCore.saveSnapshot(storage, {
        properties: state.properties || [],
        markets: state.markets || {},
        propertyMarkets: state.propertyMarkets || {},
        updatedAt,
        propertyUpdatedAt
      });
    }

    function formattedUpdatedAt(propertyId) {
      const value = Number(propertyUpdatedAt[String(propertyId)] || propertyUpdatedAt[propertyId] || 0);
      if (!value) return 'Never';
      try {
        return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch (error) {
        return new Date(value).toLocaleTimeString();
      }
    }

    function makeButton(text, action) {
      const button = documentLike.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.dataset.action = action;
      button.dataset.noDrag = 'true';
      button.style.cursor = 'pointer';
      button.style.padding = '7px 10px';
      button.style.borderRadius = '7px';
      button.style.border = '1px solid currentColor';
      button.style.background = 'transparent';
      button.style.color = 'inherit';
      return button;
    }

    function renderController() {
      const result = baseController.render();
      enhanceMainPanel();
      enhanceSettingsWindow();
      return result;
    }

    function updateProgressUi(propertyId) {
      const id = Number(propertyId);
      const panel = documentLike.getElementById('r4g3-prm-panel');
      if (!panel) return;
      const row = panel.querySelector(`[data-property-id="${id}"]`);
      if (!row) return;
      const entry = (baseController.getState().rows || []).find(item => Number(item.property && item.property.id) === id);
      if (entry) ensureCardControls(row, entry);
    }

    async function updateProperty(propertyId) {
      const id = Number(propertyId);
      if (!Number.isInteger(id) || id <= 0 || updatingProperties.has(id)) return false;
      if (typeof baseController.updateProperty !== 'function') throw new Error('Per-property update support is unavailable');
      updatingProperties.add(id);
      updateProgress.set(id, { percent: 5, label: 'Checking property status…' });
      updateProgressUi(id);
      try {
        const result = await baseController.updateProperty(id, {
          force: true,
          silent: true,
          onProgress(entry) {
            updateProgress.set(id, {
              percent: Math.max(0, Math.min(100, Number(entry && entry.percent) || 0)),
              label: String(entry && entry.label || 'Updating…')
            });
            updateProgressUi(id);
          }
        });
        const stamp = now();
        propertyUpdatedAt[String(id)] = stamp;
        updatedAt = Math.max(updatedAt, stamp);
        cancellationSent.delete(id);
        if (pendingCancelId === id) {
          pendingCancelId = null;
          pendingCancelStage = 'idle';
        }
        saveCurrentSnapshot();
        return result;
      } finally {
        updatingProperties.delete(id);
        updateProgress.delete(id);
        renderController();
      }
    }

    async function updateAll() {
      if (updatingAll) return baseController.getState();
      updatingAll = true;
      enhanceMainPanel();
      try {
        const state = await baseController.load({ force: true });
        if (!state.needsApiKey && !state.error) {
          const stamp = now();
          updatedAt = stamp;
          for (const property of state.properties || []) propertyUpdatedAt[String(property.id)] = stamp;
          cancellationSent.clear();
          if (pendingCancelId != null) {
            const pending = (state.properties || []).find(property => Number(property.id) === Number(pendingCancelId));
            if (!pending || String(pending.status || '').toLowerCase() !== 'for_rent') {
              pendingCancelId = null;
              pendingCancelStage = 'idle';
            }
          }
          saveCurrentSnapshot();
        }
        return state;
      } finally {
        updatingAll = false;
        renderController();
      }
    }

    function setAutoPageUpdate(value) {
      updateSettings = updateCore.saveSettings(storage, { autoPageUpdate: value === true });
      enhanceSettingsWindow();
      return updateSettings.autoPageUpdate;
    }

    function cancelClick(propertyId) {
      const id = Number(propertyId);
      if (!Number.isInteger(id) || id <= 0) return false;
      if (pendingCancelId !== id) {
        pendingCancelId = id;
        pendingCancelStage = 'waiting-remove';
        cancellationSent.delete(id);
        prepareCancelProperty(id);
        renderController();
        return true;
      }

      if (pendingCancelStage === 'waiting-remove') {
        if (!canCancelProperty(id)) {
          enhanceMainPanel();
          return false;
        }
        const result = cancelProperty(id);
        if (!(result && result.submitted)) {
          enhanceMainPanel();
          return false;
        }
        if (!hasCancelConfirmationBridge) {
          pendingCancelId = null;
          pendingCancelStage = 'idle';
          cancellationSent.add(id);
          renderController();
          return true;
        }
        pendingCancelStage = 'waiting-confirm';
        renderController();
        return true;
      }

      if (pendingCancelStage === 'waiting-confirm') {
        if (!canConfirmCancelProperty(id)) {
          enhanceMainPanel();
          return false;
        }
        const result = confirmCancelProperty(id);
        if (result && result.submitted) {
          pendingCancelId = null;
          pendingCancelStage = 'idle';
          cancellationSent.add(id);
          renderController();
          return true;
        }
      }
      enhanceMainPanel();
      return false;
    }

    function ensureCardControls(row, entry) {
      const property = entry && entry.property || {};
      const id = Number(property.id);
      if (!id) return;
      let controls = row.querySelector('[data-role="v034-card-controls"]');
      if (!controls) {
        controls = documentLike.createElement('div');
        controls.dataset.role = 'v034-card-controls';
        controls.style.gridColumn = '1 / -1';
        controls.style.display = 'flex';
        controls.style.flexWrap = 'wrap';
        controls.style.alignItems = 'center';
        controls.style.gap = '8px';
        controls.style.marginTop = '4px';
        row.appendChild(controls);
      }

      let updated = controls.querySelector('[data-role="v034-last-updated"]');
      if (!updated) {
        updated = documentLike.createElement('small');
        updated.dataset.role = 'v034-last-updated';
        updated.style.opacity = '0.72';
        updated.style.marginRight = 'auto';
        controls.appendChild(updated);
      }
      const updatedText = `Last updated: ${formattedUpdatedAt(id)}`;
      if (updated.textContent !== updatedText) updated.textContent = updatedText;

      let updateButton = controls.querySelector('[data-action="v034-update-property"]');
      if (!updateButton) {
        updateButton = makeButton('↻ UPDATE', 'v034-update-property');
        updateButton.dataset.propertyId = String(id);
        updateButton.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          updateProperty(id).catch(() => {});
        });
        controls.appendChild(updateButton);
      }
      const isUpdating = updatingProperties.has(id);
      const updateText = isUpdating ? 'UPDATING…' : '↻ UPDATE';
      if (updateButton.textContent !== updateText) updateButton.textContent = updateText;
      updateButton.disabled = isUpdating;

      let progress = controls.querySelector('[data-role="v035-update-progress"]');
      const progressState = updateProgress.get(id);
      if (progressState) {
        if (!progress) {
          progress = documentLike.createElement('div');
          progress.dataset.role = 'v035-update-progress';
          progress.style.flexBasis = '100%';
          progress.style.display = 'grid';
          progress.style.gap = '4px';
          const label = documentLike.createElement('small');
          label.dataset.role = 'v035-update-progress-label';
          const track = documentLike.createElement('div');
          track.setAttribute('role', 'progressbar');
          track.setAttribute('aria-valuemin', '0');
          track.setAttribute('aria-valuemax', '100');
          track.style.height = '7px';
          track.style.border = '1px solid currentColor';
          track.style.borderRadius = '999px';
          track.style.overflow = 'hidden';
          track.style.opacity = '0.85';
          const fill = documentLike.createElement('div');
          fill.dataset.role = 'v035-update-progress-fill';
          fill.style.height = '100%';
          fill.style.background = 'currentColor';
          fill.style.transition = 'width 120ms linear';
          track.appendChild(fill);
          progress.append(label, track);
          controls.appendChild(progress);
        }
        const amount = Math.max(0, Math.min(100, Number(progressState.percent) || 0));
        const label = progress.querySelector('[data-role="v035-update-progress-label"]');
        const track = progress.querySelector('[role="progressbar"]');
        const fill = progress.querySelector('[data-role="v035-update-progress-fill"]');
        if (label) label.textContent = `${progressState.label || 'Updating…'} ${Math.round(amount)}%`;
        if (track) track.setAttribute('aria-valuenow', String(Math.round(amount)));
        if (fill) fill.style.width = `${amount}%`;
      } else if (progress && progress.parentNode) {
        progress.remove();
      }

      const status = String(property.status || '').toLowerCase();
      let cancelButton = controls.querySelector('[data-action="v034-cancel-listing"]');
      let note = row.querySelector('[data-role="v034-cancel-note"]');

      if (status === 'for_rent' && !cancellationSent.has(id)) {
        if (!cancelButton) {
          cancelButton = makeButton('CANCEL LISTING', 'v034-cancel-listing');
          cancelButton.dataset.propertyId = String(id);
          cancelButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            cancelClick(id);
          });
          controls.appendChild(cancelButton);
        }
        const pending = pendingCancelId === id;
        let ready = false;
        let label = 'CANCEL LISTING';
        if (pending && pendingCancelStage === 'waiting-remove') {
          ready = canCancelProperty(id);
          label = ready ? 'CONFIRM CANCEL LISTING' : 'WAITING FOR TORN…';
        } else if (pending && pendingCancelStage === 'waiting-confirm') {
          ready = canConfirmCancelProperty(id);
          label = ready ? 'FINAL CONFIRM CANCEL' : 'WAITING FOR CONFIRMATION…';
        }
        if (cancelButton.textContent !== label) cancelButton.textContent = label;
        cancelButton.disabled = pending && !ready;
        if (note && note.parentNode) note.remove();
      } else {
        if (cancelButton && cancelButton.parentNode) cancelButton.remove();
        if (cancellationSent.has(id)) {
          if (!note) {
            note = documentLike.createElement('div');
            note.dataset.role = 'v034-cancel-note';
            note.style.gridColumn = '1 / -1';
            note.style.fontWeight = '700';
            note.style.padding = '8px 10px';
            note.style.border = '1px solid currentColor';
            note.style.borderRadius = '8px';
            row.appendChild(note);
          }
          const text = 'CANCELLATION SENT • Press UPDATE PROPERTY to verify Torn removed the listing.';
          if (note.textContent !== text) note.textContent = text;
        } else if (status === 'rented') {
          if (!note) {
            note = documentLike.createElement('div');
            note.dataset.role = 'v034-cancel-note';
            note.style.gridColumn = '1 / -1';
            note.style.opacity = '0.78';
            note.style.paddingTop = '4px';
            row.appendChild(note);
          }
          const text = 'Active lease cannot be cancelled.';
          if (note.textContent !== text) note.textContent = text;
        } else if (note && note.parentNode) {
          note.remove();
        }
      }
    }

    function enhanceHeader(panel) {
      const header = panel && panel.querySelector('.r4g3-prm-header');
      if (!header) return;
      let updateAllButton = header.querySelector('[data-action="v034-update-all"]');
      if (!updateAllButton) {
        const legacy = header.querySelector('[data-action="refresh"]');
        if (legacy) {
          legacy.dataset.action = 'v034-update-all';
          legacy.dataset.noDrag = 'true';
          updateAllButton = legacy;
        }
      }
      if (!updateAllButton) return;
      const label = updatingAll ? 'UPDATING…' : 'UPDATE ALL';
      if (updateAllButton.textContent !== label) updateAllButton.textContent = label;
      updateAllButton.disabled = updatingAll;
      updateAllButton.title = 'Manually refresh all owned properties and their rental markets';
      if (updateAllButton.dataset.v034Bound !== '1') {
        updateAllButton.dataset.v034Bound = '1';
        updateAllButton.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          updateAll().catch(() => {});
        });
      }
    }

    function enhanceEmptyState(panel) {
      const state = baseController.getState();
      if ((state.rows || []).length || savedSnapshot) return;
      let note = panel.querySelector('[data-role="v034-empty-note"]');
      if (!note) {
        note = documentLike.createElement('div');
        note.dataset.role = 'v034-empty-note';
        note.style.padding = '18px';
        note.style.textAlign = 'center';
        note.style.opacity = '0.8';
        note.textContent = 'No saved property data. Press UPDATE ALL to load your properties.';
        const handle = panel.querySelector('[data-role="resize-handle"]');
        if (handle) panel.insertBefore(note, handle);
        else panel.appendChild(note);
      }
    }

    function enhanceMainPanel() {
      if (destroyed) return null;
      const panel = documentLike.getElementById('r4g3-prm-panel');
      if (!panel) return null;
      enhanceHeader(panel);
      const entries = new Map((baseController.getState().rows || []).map(entry => [Number(entry.property && entry.property.id), entry]));
      for (const row of panel.querySelectorAll('[data-property-id]')) {
        const entry = entries.get(Number(row.getAttribute('data-property-id')));
        if (entry) ensureCardControls(row, entry);
      }
      enhanceEmptyState(panel);
      return panel;
    }

    function settingsSection(title) {
      const section = documentLike.createElement('section');
      section.dataset.role = 'v034-update-settings';
      section.style.padding = '12px';
      section.style.margin = '0 10px 10px';
      section.style.border = '1px solid rgba(128,128,128,0.35)';
      section.style.borderRadius = '9px';
      section.style.display = 'grid';
      section.style.gap = '10px';
      const heading = documentLike.createElement('strong');
      heading.textContent = title;
      section.appendChild(heading);
      return section;
    }

    function enhanceSettingsWindow() {
      const node = documentLike.getElementById('r4g3-prm-settings-window');
      if (!node) return null;
      const apiSection = node.querySelector('[data-role="api-settings"]');
      let updates = node.querySelector('[data-role="v034-update-settings"]');
      if (!updates) {
        updates = settingsSection('UPDATES');
        if (apiSection && apiSection.parentNode) apiSection.parentNode.insertBefore(updates, apiSection);
        else node.appendChild(updates);
      }

      if (!updates.querySelector('[data-action="v035-update-mode-manual"]')) {
        updates.replaceChildren();
        const heading = documentLike.createElement('strong');
        heading.textContent = 'UPDATES';
        updates.appendChild(heading);
        const modes = documentLike.createElement('div');
        modes.style.display = 'grid';
        modes.style.gridTemplateColumns = '1fr 1fr';
        modes.style.gap = '8px';
        const manual = makeButton('MANUAL', 'v035-update-mode-manual');
        const automatic = makeButton('AUTOMATIC', 'v035-update-mode-automatic');
        manual.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          setAutoPageUpdate(false);
        });
        automatic.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          setAutoPageUpdate(true);
        });
        modes.append(manual, automatic);
        const help = documentLike.createElement('small');
        help.style.opacity = '0.72';
        help.textContent = 'Manual: updates only when you press UPDATE or UPDATE ALL. Automatic page update: one UPDATE ALL when the Torn Properties page opens. No background polling.';
        updates.append(modes, help);
      }

      const manual = updates.querySelector('[data-action="v035-update-mode-manual"]');
      const automatic = updates.querySelector('[data-action="v035-update-mode-automatic"]');
      const auto = updateSettings.autoPageUpdate === true;
      if (manual) {
        manual.setAttribute('aria-pressed', String(!auto));
        manual.style.fontWeight = !auto ? '700' : '400';
        manual.style.boxShadow = !auto ? 'inset 0 0 0 2px currentColor' : 'none';
      }
      if (automatic) {
        automatic.setAttribute('aria-pressed', String(auto));
        automatic.style.fontWeight = auto ? '700' : '400';
        automatic.style.boxShadow = auto ? 'inset 0 0 0 2px currentColor' : 'none';
      }

      if (apiSection) {
        let safety = apiSection.querySelector('[data-role="v034-api-safety"]');
        if (!safety) {
          safety = documentLike.createElement('div');
          safety.dataset.role = 'v034-api-safety';
          safety.style.paddingTop = '8px';
          safety.style.borderTop = '1px solid rgba(128,128,128,0.25)';
          safety.innerHTML = '<strong>API Safety</strong><br><small>Request limit: 80 / minute • Minimum spacing: 750 ms • Rate-limit cooldown: 60 seconds</small>';
          apiSection.appendChild(safety);
        }
        const force = apiSection.querySelector('[data-action="v033-force-refresh"]');
        if (force) {
          force.dataset.action = 'v034-update-all-now';
          force.textContent = 'UPDATE ALL NOW';
          if (force.dataset.v034Bound !== '1') {
            force.dataset.v034Bound = '1';
            force.addEventListener('click', event => {
              event.preventDefault();
              event.stopPropagation();
              updateAll().catch(() => {});
            });
          }
        }
      }
      return node;
    }

    function installUiObserver() {
      if (!windowLike.MutationObserver || !documentLike.body || uiObserver) return;
      uiObserver = new windowLike.MutationObserver(records => {
        let settingsAdded = false;
        let nativeCancelChanged = false;
        for (const record of records) {
          const target = record.target;
          const inManager = target && target.closest && target.closest('#r4g3-prm-panel, #r4g3-prm-settings-window');
          for (const added of record.addedNodes || []) {
            if (!added || added.nodeType !== 1) continue;
            if (added.matches && added.matches('#r4g3-prm-settings-window') || added.querySelector && added.querySelector('#r4g3-prm-settings-window')) {
              settingsAdded = true;
            }
          }
          if (pendingCancelId != null && !inManager) nativeCancelChanged = true;
        }
        if (!settingsAdded && !nativeCancelChanged) return;
        if (observerScheduled) return;
        observerScheduled = true;
        const schedule = typeof windowLike.queueMicrotask === 'function'
          ? windowLike.queueMicrotask.bind(windowLike)
          : callback => windowLike.setTimeout(callback, 0);
        schedule(() => {
          observerScheduled = false;
          if (settingsAdded) enhanceSettingsWindow();
          if (nativeCancelChanged) enhanceMainPanel();
        });
      });
      uiObserver.observe(documentLike.body, { childList: true, subtree: true });
    }

    const controller = Object.assign({}, baseController, {
      load: updateAll,
      updateAll,
      updateProperty,
      render: renderController,
      open() {
        const result = baseController.open();
        enhanceMainPanel();
        return result;
      },
      openSettings() {
        const result = baseController.openSettings();
        enhanceSettingsWindow();
        return result;
      },
      getUpdateSettings: () => Object.assign({}, updateSettings),
      setAutoPageUpdate,
      destroy() {
        destroyed = true;
        if (uiObserver) uiObserver.disconnect();
        uiObserver = null;
        return baseController.destroy();
      }
    });

    installUiObserver();
    enhanceMainPanel();
    enhanceSettingsWindow();
    return Object.freeze(controller);
  }

  return Object.freeze(Object.assign({}, baseApp, {
    UPDATE_SETTINGS_KEY: updateCore.SETTINGS_KEY,
    SNAPSHOT_KEY: updateCore.SNAPSHOT_KEY,
    loadUpdateSettings: updateCore.loadSettings,
    saveUpdateSettings: updateCore.saveSettings,
    loadSnapshot: updateCore.loadSnapshot,
    saveSnapshot: updateCore.saveSnapshot,
    createController
  }));
}));

/* --- app runtime source: src/app-v036.js --- */
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
      observer = new windowLike.MutationObserver(() => scheduleEnhance());
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

/* --- app runtime source: src/app-v037.js --- */
(function (root, factory) {
  const baseApp = typeof module === 'object' && module.exports ? require('./app-v036') : root.R4G3PropertyRentalApp;
  const api = factory(baseApp);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalApp = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (baseApp) {
  'use strict';

  if (!baseApp) throw new Error('v0.3.7 app dependency is unavailable');

  const BULK_MARKET_DELAY_MS = 1500;

  function uniquePropertyTypeCount(properties) {
    return new Set((Array.isArray(properties) ? properties : [])
      .map(property => Number(property && property.propertyTypeId))
      .filter(id => Number.isInteger(id) && id > 0)).size;
  }

  function wrapApiClient(client, afterProgress) {
    if (!client || typeof client.scanMarkets !== 'function') return client;
    return Object.assign({}, client, {
      scanMarkets(properties, options) {
        const scanOptions = Object.assign({}, options || {});
        if (scanOptions.force === true && uniquePropertyTypeCount(properties) > 1) {
          scanOptions.sequential = true;
          scanOptions.betweenMarketsMs = Math.max(
            BULK_MARKET_DELAY_MS,
            Number(scanOptions.betweenMarketsMs) || 0
          );
        }

        const originalProgress = typeof scanOptions.onProgress === 'function'
          ? scanOptions.onProgress
          : null;
        if (originalProgress && typeof afterProgress === 'function') {
          scanOptions.onProgress = entry => {
            originalProgress(entry);
            afterProgress(entry);
          };
        }
        return client.scanMarkets(properties, scanOptions);
      }
    });
  }

  function createController(options) {
    const config = Object.assign({}, options || {});
    const windowLike = config.window;
    const documentLike = config.document;
    if (!windowLike || !documentLike) throw new TypeError('window and document are required');

    let baseController = null;
    let refreshProgress = () => null;
    const progressHook = () => refreshProgress();

    if (config.apiClient) config.apiClient = wrapApiClient(config.apiClient, progressHook);
    if (typeof config.apiClientFactory === 'function') {
      const factory = config.apiClientFactory;
      config.apiClientFactory = apiKey => wrapApiClient(factory(apiKey), progressHook);
    }

    baseController = baseApp.createController(config);
    let observer = null;
    let scheduled = false;
    let destroyed = false;

    function progressState() {
      const state = baseController && baseController.getState();
      if (!state || state.loading !== true) return null;
      const scan = state.scanProgress && typeof state.scanProgress === 'object'
        ? state.scanProgress
        : null;
      const total = Math.max(0, Number(scan && scan.total) || 0);
      const done = Math.max(0, Math.min(total || Infinity, Number(scan && scan.done) || 0));
      const percent = total > 0 ? Math.max(0, Math.min(100, Math.round(done / total * 100))) : 0;
      return {
        done,
        total,
        percent,
        label: total > 0
          ? `Updating rental markets… ${done} / ${total}`
          : 'Loading owned properties…'
      };
    }

    function enhanceBulkProgress() {
      scheduled = false;
      if (destroyed) return null;
      const panel = documentLike.getElementById('r4g3-prm-panel');
      if (!panel) return null;

      const state = progressState();
      let progress = panel.querySelector('[data-role="v037-update-all-progress"]');
      if (!state) {
        if (progress && progress.parentNode) progress.remove();
        return null;
      }

      if (!progress) {
        progress = documentLike.createElement('div');
        progress.dataset.role = 'v037-update-all-progress';
        progress.style.padding = '9px 12px';
        progress.style.display = 'grid';
        progress.style.gap = '6px';
        progress.style.borderBottom = '1px solid rgba(128,128,128,0.25)';

        const label = documentLike.createElement('small');
        label.dataset.role = 'v037-update-all-progress-label';
        label.style.fontWeight = '700';

        const track = documentLike.createElement('div');
        track.setAttribute('role', 'progressbar');
        track.setAttribute('aria-label', 'Update all progress');
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', '100');
        track.style.height = '9px';
        track.style.border = '1px solid currentColor';
        track.style.borderRadius = '999px';
        track.style.overflow = 'hidden';
        track.style.opacity = '0.9';

        const fill = documentLike.createElement('div');
        fill.dataset.role = 'v037-update-all-progress-fill';
        fill.style.height = '100%';
        fill.style.width = '0%';
        fill.style.background = 'currentColor';
        fill.style.transition = 'width 160ms linear';
        track.appendChild(fill);
        progress.append(label, track);

        const header = panel.querySelector('.r4g3-prm-header');
        if (header && header.nextSibling) panel.insertBefore(progress, header.nextSibling);
        else if (header) panel.appendChild(progress);
        else panel.prepend(progress);
      }

      const label = progress.querySelector('[data-role="v037-update-all-progress-label"]');
      const track = progress.querySelector('[role="progressbar"]');
      const fill = progress.querySelector('[data-role="v037-update-all-progress-fill"]');
      if (label && label.textContent !== state.label) label.textContent = state.label;
      if (track) {
        track.setAttribute('aria-valuenow', String(state.percent));
        track.setAttribute('aria-valuetext', state.total > 0 ? `${state.done} of ${state.total} markets` : 'Loading properties');
      }
      if (fill) fill.style.width = `${state.percent}%`;
      return progress;
    }

    refreshProgress = enhanceBulkProgress;

    function scheduleEnhance() {
      if (scheduled || destroyed) return;
      scheduled = true;
      const schedule = typeof windowLike.queueMicrotask === 'function'
        ? windowLike.queueMicrotask.bind(windowLike)
        : callback => Promise.resolve().then(callback);
      schedule(enhanceBulkProgress);
    }

    if (typeof windowLike.MutationObserver === 'function' && (documentLike.body || documentLike.documentElement)) {
      observer = new windowLike.MutationObserver(() => scheduleEnhance());
      observer.observe(documentLike.body || documentLike.documentElement, { childList: true, subtree: true });
    }

    async function wrapAsync(method, args) {
      try {
        return await baseController[method](...args);
      } finally {
        enhanceBulkProgress();
      }
    }

    const controller = Object.assign({}, baseController, {
      load(...args) { return wrapAsync('load', args); },
      updateAll(...args) { return wrapAsync('updateAll', args); },
      updateProperty(...args) { return wrapAsync('updateProperty', args); },
      render() {
        const result = baseController.render();
        enhanceBulkProgress();
        return result;
      },
      open() {
        const result = baseController.open();
        enhanceBulkProgress();
        return result;
      },
      destroy() {
        destroyed = true;
        if (observer) observer.disconnect();
        observer = null;
        return baseController.destroy();
      }
    });

    enhanceBulkProgress();
    return Object.freeze(controller);
  }

  return Object.freeze(Object.assign({}, baseApp, {
    BULK_MARKET_DELAY_MS,
    wrapApiClient,
    createController
  }));
}));

/* --- app runtime source: src/app-v038.js --- */
(function (root, factory) {
  const baseApp = typeof module === 'object' && module.exports ? require('./app-v037') : root.R4G3PropertyRentalApp;
  const updateCore = typeof module === 'object' && module.exports ? require('./update-core-v034') : root.R4G3UpdateCoreV034;
  const api = factory(baseApp, updateCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalApp = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (baseApp, updateCore) {
  'use strict';

  if (!baseApp || !updateCore) throw new Error('v0.3.8 app dependencies are unavailable');

  function createController(options) {
    const config = options || {};
    const windowLike = config.window;
    const documentLike = config.document;
    const storage = config.storage || windowLike && windowLike.localStorage;
    if (!windowLike || !documentLike) throw new TypeError('window and document are required');

    const baseController = baseApp.createController(config);
    let syncPromise = null;
    let cachedSyncClient = null;
    let cachedSyncKey = null;
    let observer = null;
    let scheduled = false;
    let destroyed = false;

    function syncClient() {
      if (config.apiClient) return config.apiClient;
      if (typeof config.apiClientFactory !== 'function') return null;
      const settings = typeof baseController.getSettings === 'function' ? baseController.getSettings() : {};
      const key = String(settings && settings.apiKey || '').trim();
      if (!key) return null;
      if (cachedSyncClient && cachedSyncKey === key) return cachedSyncClient;
      cachedSyncClient = config.apiClientFactory(key);
      cachedSyncKey = key;
      return cachedSyncClient;
    }

    function filterPropertyMarkets(propertyMarkets, properties) {
      const source = propertyMarkets && typeof propertyMarkets === 'object' ? propertyMarkets : {};
      const ownedIds = new Set((Array.isArray(properties) ? properties : []).map(property => String(property.id)));
      const result = {};
      for (const [id, market] of Object.entries(source)) {
        if (ownedIds.has(String(id))) result[id] = market;
      }
      return result;
    }

    function savePropertySnapshot(properties, markets, propertyMarkets) {
      const previous = updateCore.loadSnapshot(storage) || {};
      const checkedAt = Date.now();
      const propertyCheckedAt = Object.assign({}, previous.propertyCheckedAt || {});
      for (const property of Array.isArray(properties) ? properties : []) {
        const id = Number(property && property.id);
        if (Number.isInteger(id) && id > 0) propertyCheckedAt[String(id)] = checkedAt;
      }
      updateCore.saveSnapshot(storage, {
        properties,
        markets: markets || {},
        propertyMarkets: propertyMarkets || {},
        updatedAt: Number(previous.updatedAt) || 0,
        propertyUpdatedAt: Object.assign({}, previous.propertyUpdatedAt || {}),
        propertyCheckedAt,
        marketCheckedAt: Object.assign({}, previous.marketCheckedAt || {})
      });
    }

    function enhanceUi() {
      scheduled = false;
      if (destroyed) return;
      const panel = documentLike.getElementById('r4g3-prm-panel');
      if (panel) {
        for (const button of panel.querySelectorAll('[data-action="v034-update-property"]')) {
          if (button.disabled) {
            if (button.textContent !== 'SCANNING…') button.textContent = 'SCANNING…';
          } else if (button.textContent !== 'SCAN MARKET') {
            button.textContent = 'SCAN MARKET';
          }
          button.title = 'Refresh this property and scan only its matching Torn rental market';
        }
        const updateAll = panel.querySelector('[data-action="v034-update-all"]');
        if (updateAll) updateAll.title = 'Deliberately scan rental markets for all owned properties';
        const empty = panel.querySelector('[data-role="v034-empty-note"]');
        const emptyText = 'Loading your owned properties automatically. Rental markets are scanned only when you choose SCAN MARKET or UPDATE ALL.';
        if (empty && empty.textContent !== emptyText) empty.textContent = emptyText;
      }

      const settings = documentLike.getElementById('r4g3-prm-settings-window');
      if (settings) {
        const updates = settings.querySelector('[data-role="v034-update-settings"]');
        if (updates) {
          const manual = updates.querySelector('[data-action="v035-update-mode-manual"]');
          const automatic = updates.querySelector('[data-action="v035-update-mode-automatic"]');
          if (manual && manual.parentElement) manual.parentElement.style.display = 'none';
          if (automatic && automatic.parentElement) automatic.parentElement.style.display = 'none';
          let note = updates.querySelector('[data-role="v038-update-help"]');
          if (!note) {
            note = documentLike.createElement('small');
            note.dataset.role = 'v038-update-help';
            note.style.opacity = '0.78';
            updates.appendChild(note);
          }
          const noteText = 'Owned properties refresh automatically when the manager opens. Rental-market scans are always manual: SCAN MARKET for one property, or UPDATE ALL for a deliberate bulk scan.';
          if (note.textContent !== noteText) note.textContent = noteText;
          for (const child of updates.querySelectorAll('small')) {
            if (child !== note) child.style.display = 'none';
          }
        }
      }
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

    async function performPropertySync() {
      const client = syncClient();
      if (!client) {
        if (typeof baseController.openSettings === 'function') baseController.openSettings();
        enhanceUi();
        return baseController.getState();
      }
      if (typeof client.fetchOwnedProperties !== 'function') throw new TypeError('API client cannot load owned properties');

      const currentUserId = typeof client.fetchCurrentUserId === 'function'
        ? await client.fetchCurrentUserId()
        : null;
      const rawProperties = await client.fetchOwnedProperties();
      const properties = config.propertyCore.normalizeProperties(rawProperties, currentUserId);
      const previousState = baseController.getState();
      const markets = Object.assign({}, previousState && previousState.markets || {});
      const propertyMarkets = filterPropertyMarkets(previousState && previousState.propertyMarkets, properties);

      if (typeof baseController.hydrate !== 'function') throw new Error('Property hydration support is unavailable');
      baseController.hydrate({ properties, markets, propertyMarkets });
      baseController.render();
      savePropertySnapshot(properties, markets, propertyMarkets);
      enhanceUi();
      return baseController.getState();
    }

    function syncOwnedProperties() {
      if (syncPromise) return syncPromise;
      syncPromise = performPropertySync().finally(() => {
        syncPromise = null;
        enhanceUi();
      });
      return syncPromise;
    }

    function wrapAsync(method, args) {
      return Promise.resolve(baseController[method](...args)).finally(enhanceUi);
    }

    const controller = Object.assign({}, baseController, {
      load: syncOwnedProperties,
      syncOwnedProperties,
      updateProperty(...args) { return wrapAsync('updateProperty', args); },
      updateAll(...args) { return wrapAsync('updateAll', args); },
      render() {
        const result = baseController.render();
        enhanceUi();
        return result;
      },
      open() {
        const result = baseController.open();
        enhanceUi();
        syncOwnedProperties().catch(() => {});
        return result;
      },
      openSettings() {
        const result = baseController.openSettings();
        enhanceUi();
        return result;
      },
      getUpdateSettings() {
        const existing = typeof baseController.getUpdateSettings === 'function'
          ? baseController.getUpdateSettings()
          : {};
        return Object.assign({}, existing || {}, { autoPageUpdate: false });
      },
      destroy() {
        destroyed = true;
        if (observer) observer.disconnect();
        observer = null;
        return baseController.destroy();
      }
    });

    enhanceUi();
    Promise.resolve().then(() => syncOwnedProperties()).catch(() => {});
    return Object.freeze(controller);
  }

  return Object.freeze(Object.assign({}, baseApp, { createController }));
}));

/* --- app runtime source: src/app-v039.js --- */
(function (root, factory) {
  const baseApp = typeof module === 'object' && module.exports ? require('./app-v038') : root.R4G3PropertyRentalApp;
  const api = factory(baseApp);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalApp = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (baseApp) {
  'use strict';

  if (!baseApp) throw new Error('v0.3.9 app dependency is unavailable');

  function pagePercent(entry) {
    const donePages = Math.max(0, Number(entry && entry.donePages) || 0);
    const totalPages = Math.max(0, Number(entry && entry.totalPages) || 0);
    if (totalPages > 0) {
      return Math.max(36, Math.min(90, Math.round(35 + (donePages / totalPages) * 55)));
    }
    return Math.max(36, Math.min(90, 35 + donePages * 5));
  }

  function pageLabel(entry, percent) {
    const donePages = Math.max(0, Number(entry && entry.donePages) || 0);
    const totalPages = Math.max(0, Number(entry && entry.totalPages) || 0);
    const rowsDone = Math.max(0, Number(entry && entry.rowsDone) || 0);
    const totalRows = Math.max(0, Number(entry && entry.totalRows) || 0);
    const pageText = totalPages > 0 ? `page ${donePages} / ${totalPages}` : `page ${donePages}`;
    const rowsText = totalRows > 0 ? ` • ${rowsDone} / ${totalRows} listings` : rowsDone > 0 ? ` • ${rowsDone} listings` : '';
    return `Searching rental market… ${pageText}${rowsText} ${Math.round(percent)}%`;
  }

  function renderPageProgress(documentLike, propertyId, entry) {
    if (!documentLike || typeof documentLike.querySelector !== 'function') return false;
    const id = Number(propertyId);
    if (!Number.isInteger(id) || id <= 0) return false;
    const row = documentLike.querySelector(`[data-property-id="${id}"]`);
    if (!row) return false;
    const controls = row.querySelector('[data-role="v034-card-controls"]') || row;
    const legacy = controls.querySelector('[data-role="v035-update-progress"]');
    if (legacy) {
      legacy.dataset.v039Hidden = '1';
      legacy.style.display = 'none';
    }

    let progress = controls.querySelector('[data-role="v039-market-page-progress"]');
    if (!progress) {
      progress = documentLike.createElement('div');
      progress.dataset.role = 'v039-market-page-progress';
      progress.style.flexBasis = '100%';
      progress.style.display = 'grid';
      progress.style.gap = '4px';

      const label = documentLike.createElement('small');
      label.dataset.role = 'v039-market-page-progress-label';

      const track = documentLike.createElement('div');
      track.setAttribute('role', 'progressbar');
      track.setAttribute('aria-label', 'Rental market page progress');
      track.setAttribute('aria-valuemin', '0');
      track.setAttribute('aria-valuemax', '100');
      track.style.height = '7px';
      track.style.border = '1px solid currentColor';
      track.style.borderRadius = '999px';
      track.style.overflow = 'hidden';
      track.style.opacity = '0.85';

      const fill = documentLike.createElement('div');
      fill.dataset.role = 'v039-market-page-progress-fill';
      fill.style.height = '100%';
      fill.style.background = 'currentColor';
      fill.style.transition = 'width 120ms linear';
      track.appendChild(fill);
      progress.append(label, track);
      controls.appendChild(progress);
    }

    const percent = pagePercent(entry);
    const label = progress.querySelector('[data-role="v039-market-page-progress-label"]');
    const track = progress.querySelector('[role="progressbar"]');
    const fill = progress.querySelector('[data-role="v039-market-page-progress-fill"]');
    if (label) label.textContent = pageLabel(entry, percent);
    if (track) {
      track.setAttribute('aria-valuenow', String(Math.round(percent)));
      const donePages = Math.max(0, Number(entry && entry.donePages) || 0);
      const totalPages = Math.max(0, Number(entry && entry.totalPages) || 0);
      track.setAttribute('aria-valuetext', totalPages > 0 ? `${donePages} of ${totalPages} rental-market pages` : `${donePages} rental-market pages`);
    }
    if (fill) fill.style.width = `${percent}%`;
    return true;
  }

  function clearPageProgress(documentLike, propertyId) {
    if (!documentLike || typeof documentLike.querySelector !== 'function') return;
    const id = Number(propertyId);
    if (!Number.isInteger(id) || id <= 0) return;
    const row = documentLike.querySelector(`[data-property-id="${id}"]`);
    if (!row) return;
    const progress = row.querySelector('[data-role="v039-market-page-progress"]');
    if (progress && progress.parentNode) progress.remove();
    const legacy = row.querySelector('[data-role="v035-update-progress"][data-v039-hidden="1"]');
    if (legacy) {
      legacy.style.display = '';
      delete legacy.dataset.v039Hidden;
    }
  }

  function wrapApiClient(client, documentLike) {
    if (!client || typeof client.scanMarkets !== 'function') return client;
    return Object.assign({}, client, {
      scanMarkets(properties, options) {
        const scanOptions = Object.assign({}, options || {});
        const source = Array.isArray(properties) ? properties : [];
        const propertyId = source.length === 1 ? Number(source[0] && source[0].id) : 0;
        const originalPageProgress = typeof scanOptions.onPageProgress === 'function'
          ? scanOptions.onPageProgress
          : null;
        const originalProgress = typeof scanOptions.onProgress === 'function'
          ? scanOptions.onProgress
          : null;

        scanOptions.onPageProgress = entry => {
          if (originalPageProgress) originalPageProgress(entry);
          if (propertyId > 0) renderPageProgress(documentLike, propertyId, entry);
        };
        if (originalProgress) {
          scanOptions.onProgress = entry => {
            originalProgress(entry);
            if (propertyId > 0) clearPageProgress(documentLike, propertyId);
          };
        }

        const result = client.scanMarkets(properties, scanOptions);
        if (!result || typeof result.finally !== 'function' || propertyId <= 0) return result;
        return result.finally(() => clearPageProgress(documentLike, propertyId));
      }
    });
  }

  function createController(options) {
    const config = Object.assign({}, options || {});
    const documentLike = config.document;
    if (!documentLike) throw new TypeError('document is required');

    if (config.apiClient) config.apiClient = wrapApiClient(config.apiClient, documentLike);
    if (typeof config.apiClientFactory === 'function') {
      const factory = config.apiClientFactory;
      config.apiClientFactory = apiKey => wrapApiClient(factory(apiKey), documentLike);
    }

    return baseApp.createController(config);
  }

  return Object.freeze(Object.assign({}, baseApp, {
    pagePercent,
    pageLabel,
    renderPageProgress,
    clearPageProgress,
    wrapApiClient,
    createController
  }));
}));

/* --- app runtime source: src/app-v0310.js --- */
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

      const active = activeScans.get(Number(propertyId));
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

/* --- app runtime source: src/app-runtime.js --- */
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
    RUNTIME_VERSION: '0.4.1',
    OBSERVER_MODE: 'multiplexed',
    createController
  }));
}));


/* ===== src/bootstrap.js ===== */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalBootstrap = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

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

  function createApiFetch(windowLike) {
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

          function cleanup() {
            if (signal && abortListener && typeof signal.removeEventListener === 'function') {
              signal.removeEventListener('abort', abortListener);
            }
            abortListener = null;
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
            timeout: 30000,
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
              rejectOnce(new Error('Torn API request timed out'));
            },
            onerror() {
              rejectOnce(new Error('Torn API request failed'));
            },
            onabort() {
              rejectOnce(makeAbortError());
            }
          });

          if (signal && typeof signal.addEventListener === 'function') {
            signal.addEventListener('abort', abortListener, { once: true });
            if (signal.aborted) abortListener();
          }
        });
      }

      if (!windowLike || typeof windowLike.fetch !== 'function') {
        return Promise.reject(new Error('No supported HTTP transport is available'));
      }
      return windowLike.fetch(url.toString(), request);
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
    let observer = null;

    function makeButton(id, floating) {
      const button = documentLike.createElement('button');
      button.id = id;
      button.type = 'button';
      button.title = 'Open Property Rental Manager';
      button.setAttribute('aria-label', 'Open Property Rental Manager');
      button.style.cursor = 'pointer';
      button.style.display = 'inline-flex';
      button.style.alignItems = 'center';
      button.style.justifyContent = 'center';
      button.style.gap = '6px';
      button.style.border = '1px solid rgba(116,255,139,0.55)';
      button.style.borderRadius = '7px';
      button.style.background = '#111512';
      button.style.color = '#74ff8b';
      button.style.padding = floating ? '9px 11px' : '6px 8px';
      button.style.fontSize = '12px';
      button.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 11.5 12 4l9 7.5v8a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1v-8Z"/></svg><span>Rentals</span>';
      button.addEventListener('click', event => {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        onOpen();
      });
      if (floating) {
        button.style.position = 'fixed';
        button.style.right = '14px';
        button.style.bottom = '76px';
        button.style.zIndex = '99998';
        button.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
      }
      return button;
    }

    function finishEnsure(button) {
      onEnsure();
      return button;
    }

    function ensure() {
      if (!documentLike || !documentLike.body) return null;
      let sidebar = documentLike.getElementById('r4g3-prm-sidebar-launcher');
      let floating = documentLike.getElementById('r4g3-prm-floating-launcher');
      const information = findInformationSection(documentLike);

      if (information) {
        if (!sidebar || !information.contains(sidebar)) {
          if (sidebar && sidebar.parentNode) sidebar.remove();
          sidebar = makeButton('r4g3-prm-sidebar-launcher', false);
          const host = information.querySelector && information.querySelector('.links,ul,ol') || information;
          host.appendChild(sidebar);
        }
        if (floating && floating.parentNode) floating.remove();
        return finishEnsure(sidebar);
      }

      if (sidebar && sidebar.parentNode) sidebar.remove();
      if (!floating) {
        floating = makeButton('r4g3-prm-floating-launcher', true);
        documentLike.body.appendChild(floating);
      }
      return finishEnsure(floating);
    }

    function start() {
      ensure();
      if (windowLike && windowLike.MutationObserver && documentLike && documentLike.body) {
        observer = new windowLike.MutationObserver(() => ensure());
        observer.observe(documentLike.body, { childList: true, subtree: true });
      }
      return true;
    }

    function destroy() {
      if (observer) observer.disconnect();
      observer = null;
      const sidebar = documentLike && documentLike.getElementById('r4g3-prm-sidebar-launcher');
      const floating = documentLike && documentLike.getElementById('r4g3-prm-floating-launcher');
      if (sidebar && sidebar.parentNode) sidebar.remove();
      if (floating && floating.parentNode) floating.remove();
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

/* ===== userscript start ===== */
R4G3PropertyRentalBootstrap.start();
