(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PortfolioCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const HISTORY_KEY = 'r4g3_property_rental_manager.v1.lease_history';
  const HISTORY_VERSION = 1;
  const MAX_PREVIOUS_LEASES = 8;
  const ATTENTION_FILTERS = Object.freeze([
    'all', 'attention', 'vacant', 'listed', 'rented', 'extension', 'active'
  ]);

  function integer(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : fallback;
  }

  function nonNegativeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function normalizeStatus(value) {
    return text(value).toLowerCase();
  }

  function normalizePerson(value) {
    if (!value || typeof value !== 'object') return null;
    const id = integer(value.id, 0);
    const name = text(value.name);
    if (id <= 0 && !name) return null;
    return Object.freeze({ id: id > 0 ? id : null, name });
  }

  function normalizeExtension(value) {
    if (value == null || value === false || value === 0 || value === '') return null;
    if (value === true) return { status: 'offered', cost: null, period: null, createdAt: null };
    if (typeof value !== 'object') return { status: text(value).toLowerCase() || 'offered', cost: null, period: null, createdAt: null };
    const status = text(value.status).toLowerCase();
    const cost = nonNegativeNumber(value.cost);
    const period = nonNegativeNumber(value.period != null ? value.period : value.rental_period);
    const createdAt = nonNegativeNumber(value.created_at != null ? value.created_at : value.createdAt);
    return { status, cost, period, createdAt };
  }

  function hasExtensionOffer(property) {
    return Boolean(normalizeExtension(property && property.leaseExtension));
  }

  function extensionLabel(property) {
    const extension = normalizeExtension(property && property.leaseExtension);
    if (!extension) return 'Not offered';
    if (extension.status === 'pending') return 'Pending';
    if (extension.status === 'accepted') return 'Accepted';
    if (extension.status === 'declined') return 'Declined';
    return 'Offered';
  }

  function attentionStatus(property) {
    const status = normalizeStatus(property && property.status);
    if (status === 'none') return 'vacant';
    if (status === 'for_rent') return 'listed';
    if (status !== 'rented') return 'other';

    const remaining = nonNegativeNumber(property && property.rentalPeriodRemaining);
    if (remaining == null) return hasExtensionOffer(property) ? 'extension' : 'rented';
    if (remaining <= 3) return 'urgent';
    if (remaining <= 7) return 'expiring';
    if (remaining <= 14) return 'due_soon';
    return hasExtensionOffer(property) ? 'extension' : 'active';
  }

  function needsAttention(property) {
    const status = attentionStatus(property);
    return status === 'vacant' || status === 'urgent' || status === 'expiring' || status === 'due_soon';
  }

  function summary(properties) {
    const result = {
      total: 0,
      vacant: 0,
      listed: 0,
      rented: 0,
      urgent: 0,
      expiring: 0,
      dueSoon: 0,
      extension: 0,
      active: 0,
      attention: 0
    };
    for (const property of Array.isArray(properties) ? properties : []) {
      result.total += 1;
      const status = normalizeStatus(property && property.status);
      const band = attentionStatus(property);
      if (status === 'rented') result.rented += 1;
      if (band === 'vacant') result.vacant += 1;
      else if (band === 'listed') result.listed += 1;
      else if (band === 'urgent') result.urgent += 1;
      else if (band === 'expiring') result.expiring += 1;
      else if (band === 'due_soon') result.dueSoon += 1;
      else if (band === 'active') result.active += 1;
      if (hasExtensionOffer(property)) result.extension += 1;
      if (needsAttention(property)) result.attention += 1;
    }
    return result;
  }

  function searchableText(property) {
    const renter = normalizePerson(property && property.rentedBy);
    return [
      property && property.name,
      property && property.id,
      property && property.propertyTypeId,
      renter && renter.name,
      renter && renter.id
    ].map(text).filter(Boolean).join(' ').toLowerCase();
  }

  function matchesSearch(property, query) {
    const normalized = text(query).toLowerCase();
    return !normalized || searchableText(property).includes(normalized);
  }

  function matchesFilter(property, filter) {
    const selected = ATTENTION_FILTERS.includes(filter) ? filter : 'all';
    if (selected === 'all') return true;
    const status = normalizeStatus(property && property.status);
    const band = attentionStatus(property);
    if (selected === 'attention') return needsAttention(property);
    if (selected === 'vacant') return band === 'vacant';
    if (selected === 'listed') return band === 'listed';
    if (selected === 'rented') return status === 'rented';
    if (selected === 'extension') return hasExtensionOffer(property);
    if (selected === 'active') return status === 'rented' && !needsAttention(property);
    return true;
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

  function marketDistribution(quote) {
    const targetDays = Math.max(1, Number(quote && quote.targetDays) || 100);
    const rows = quote && Array.isArray(quote.trustedMatches) ? quote.trustedMatches : [];
    const totals = rows
      .map(row => Number(row && row.equivalentTotal))
      .filter(value => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    if (!totals.length) return null;
    const average = totals.reduce((sum, value) => sum + value, 0) / totals.length;
    const total = value => value == null ? null : Math.floor(value);
    const daily = value => value == null ? null : Math.floor(value / targetDays);
    const q1 = percentile(totals, 0.25);
    const median = percentile(totals, 0.50);
    const q3 = percentile(totals, 0.75);
    const proposedTotal = Number(quote && quote.proposedTotal);
    return {
      targetDays,
      lowestTotal: total(totals[0]),
      q1Total: total(q1),
      medianTotal: total(median),
      averageTotal: total(average),
      q3Total: total(q3),
      highestTotal: total(totals[totals.length - 1]),
      q1Daily: daily(q1),
      medianDaily: daily(median),
      q3Daily: daily(q3),
      proposedDaily: Number.isFinite(proposedTotal) ? daily(proposedTotal) : null
    };
  }

  function leaseObservation(property, now) {
    if (normalizeStatus(property && property.status) !== 'rented') return null;
    const renter = normalizePerson(property && property.rentedBy);
    return {
      tenantId: renter && renter.id || null,
      tenantName: renter && renter.name || '',
      cost: nonNegativeNumber(property && property.cost),
      costPerDay: nonNegativeNumber(property && property.costPerDay),
      rentalPeriod: nonNegativeNumber(property && property.rentalPeriod),
      rentalPeriodRemaining: nonNegativeNumber(property && property.rentalPeriodRemaining),
      firstSeenAt: integer(now, Date.now()),
      lastSeenAt: integer(now, Date.now())
    };
  }

  function leaseFingerprint(observation) {
    if (!observation) return '';
    return [
      observation.tenantId || '',
      text(observation.tenantName).toLowerCase(),
      observation.cost == null ? '' : observation.cost,
      observation.costPerDay == null ? '' : observation.costPerDay,
      observation.rentalPeriod == null ? '' : observation.rentalPeriod
    ].join('|');
  }

  function normalizeObservation(value) {
    if (!value || typeof value !== 'object') return null;
    return {
      tenantId: integer(value.tenantId, 0) || null,
      tenantName: text(value.tenantName),
      cost: nonNegativeNumber(value.cost),
      costPerDay: nonNegativeNumber(value.costPerDay),
      rentalPeriod: nonNegativeNumber(value.rentalPeriod),
      rentalPeriodRemaining: nonNegativeNumber(value.rentalPeriodRemaining),
      firstSeenAt: integer(value.firstSeenAt, 0),
      lastSeenAt: integer(value.lastSeenAt, 0),
      endedSeenAt: integer(value.endedSeenAt, 0) || null
    };
  }

  function normalizeHistory(value) {
    const source = value && typeof value === 'object' ? value : {};
    const properties = {};
    const rawProperties = source.properties && typeof source.properties === 'object' ? source.properties : {};
    for (const [key, raw] of Object.entries(rawProperties)) {
      const propertyId = integer(key, 0);
      if (propertyId <= 0 || !raw || typeof raw !== 'object') continue;
      const current = normalizeObservation(raw.current);
      const previous = (Array.isArray(raw.previous) ? raw.previous : [])
        .map(normalizeObservation)
        .filter(Boolean)
        .slice(0, MAX_PREVIOUS_LEASES);
      properties[String(propertyId)] = { current, previous };
    }
    return { version: HISTORY_VERSION, properties };
  }

  function loadHistory(storage) {
    if (!storage || typeof storage.getItem !== 'function') return normalizeHistory({});
    try {
      const raw = storage.getItem(HISTORY_KEY);
      return normalizeHistory(raw ? JSON.parse(raw) : {});
    } catch (error) {
      return normalizeHistory({});
    }
  }

  function saveHistory(storage, history) {
    const normalized = normalizeHistory(history);
    if (storage && typeof storage.setItem === 'function') {
      try { storage.setItem(HISTORY_KEY, JSON.stringify(normalized)); } catch (error) { }
    }
    return normalized;
  }

  function recordProperties(historyValue, properties, nowValue) {
    const now = integer(nowValue, Date.now());
    const history = normalizeHistory(historyValue);

    for (const property of Array.isArray(properties) ? properties : []) {
      const propertyId = integer(property && property.id, 0);
      if (propertyId <= 0) continue;
      const key = String(propertyId);
      const entry = history.properties[key] || { current: null, previous: [] };
      const observed = leaseObservation(property, now);

      if (!observed) {
        if (entry.current) {
          entry.current.endedSeenAt = now;
          entry.previous = [entry.current, ...entry.previous].slice(0, MAX_PREVIOUS_LEASES);
          entry.current = null;
        }
        history.properties[key] = entry;
        continue;
      }

      if (!entry.current) {
        entry.current = observed;
      } else if (leaseFingerprint(entry.current) !== leaseFingerprint(observed)) {
        entry.current.endedSeenAt = now;
        entry.previous = [entry.current, ...entry.previous].slice(0, MAX_PREVIOUS_LEASES);
        entry.current = observed;
      } else {
        entry.current = Object.assign({}, entry.current, {
          rentalPeriodRemaining: observed.rentalPeriodRemaining,
          lastSeenAt: now
        });
      }
      history.properties[key] = entry;
    }

    return normalizeHistory(history);
  }

  function previousLease(historyValue, propertyId) {
    const history = normalizeHistory(historyValue);
    const entry = history.properties[String(integer(propertyId, 0))];
    return entry && entry.previous && entry.previous.length ? entry.previous[0] : null;
  }

  function currentObservedLease(historyValue, propertyId) {
    const history = normalizeHistory(historyValue);
    const entry = history.properties[String(integer(propertyId, 0))];
    return entry && entry.current || null;
  }

  return Object.freeze({
    HISTORY_KEY,
    HISTORY_VERSION,
    ATTENTION_FILTERS,
    normalizeExtension,
    hasExtensionOffer,
    extensionLabel,
    attentionStatus,
    needsAttention,
    summary,
    searchableText,
    matchesSearch,
    matchesFilter,
    marketDistribution,
    leaseObservation,
    leaseFingerprint,
    normalizeHistory,
    loadHistory,
    saveHistory,
    recordProperties,
    previousLease,
    currentObservedLease
  });
}));