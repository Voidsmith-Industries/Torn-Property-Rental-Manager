'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const portfolio = require('../src/portfolio-core');

function property(overrides = {}) {
  return Object.assign({
    id: 1,
    name: 'Private Island',
    propertyTypeId: 13,
    status: 'rented',
    rentalPeriodRemaining: 30,
    rentedBy: { id: 99, name: 'Tenant' },
    cost: 30000000,
    costPerDay: 1000000,
    rentalPeriod: 30,
    leaseExtension: null
  }, overrides);
}

test('v1 attention bands and extension visibility are deterministic', () => {
  assert.equal(portfolio.attentionStatus(property({ status: 'none' })), 'vacant');
  assert.equal(portfolio.attentionStatus(property({ status: 'for_rent' })), 'listed');
  assert.equal(portfolio.attentionStatus(property({ rentalPeriodRemaining: 3 })), 'urgent');
  assert.equal(portfolio.attentionStatus(property({ rentalPeriodRemaining: 7 })), 'expiring');
  assert.equal(portfolio.attentionStatus(property({ rentalPeriodRemaining: 14 })), 'due_soon');
  assert.equal(portfolio.attentionStatus(property({ rentalPeriodRemaining: 15 })), 'active');
  const offered = property({ rentalPeriodRemaining: 30, leaseExtension: { cost: 31000000, period: 30, created_at: 123 } });
  assert.equal(portfolio.attentionStatus(offered), 'extension');
  assert.equal(portfolio.extensionLabel(offered), 'Offered');
  assert.equal(portfolio.hasExtensionOffer(offered), true);
});

test('v1 summary, renter search and attention filters stay property-local', () => {
  const rows = [
    property({ id: 1, status: 'none' }),
    property({ id: 2, rentalPeriodRemaining: 2, rentedBy: { id: 100, name: 'Alice' } }),
    property({ id: 3, rentalPeriodRemaining: 10, rentedBy: { id: 101, name: 'Bob' } }),
    property({ id: 4, rentalPeriodRemaining: 40, leaseExtension: { status: 'pending' } }),
    property({ id: 5, status: 'for_rent' })
  ];
  const summary = portfolio.summary(rows);
  assert.deepEqual(
    {
      total: summary.total,
      vacant: summary.vacant,
      listed: summary.listed,
      rented: summary.rented,
      urgent: summary.urgent,
      dueSoon: summary.dueSoon,
      extension: summary.extension,
      attention: summary.attention
    },
    { total: 5, vacant: 1, listed: 1, rented: 3, urgent: 1, dueSoon: 1, extension: 1, attention: 3 }
  );
  assert.equal(portfolio.matchesSearch(rows[1], 'alice'), true);
  assert.equal(portfolio.matchesSearch(rows[1], '100'), true);
  assert.equal(portfolio.matchesFilter(rows[2], 'attention'), true);
  assert.equal(portfolio.matchesFilter(rows[3], 'extension'), true);
});

test('v1 history records only locally observed leases and never invents earlier history', () => {
  let history = portfolio.normalizeHistory({});
  history = portfolio.recordProperties(history, [property({ id: 1 })], 1000);
  assert.equal(portfolio.previousLease(history, 1), null);
  assert.equal(portfolio.currentObservedLease(history, 1).firstSeenAt, 1000);

  history = portfolio.recordProperties(history, [property({ id: 1, rentalPeriodRemaining: 29 })], 2000);
  assert.equal(portfolio.previousLease(history, 1), null);
  assert.equal(portfolio.currentObservedLease(history, 1).lastSeenAt, 2000);

  history = portfolio.recordProperties(history, [property({ id: 1, status: 'none' })], 3000);
  assert.equal(portfolio.currentObservedLease(history, 1), null);
  assert.equal(portfolio.previousLease(history, 1).tenantName, 'Tenant');

  history = portfolio.recordProperties(history, [property({
    id: 1,
    rentedBy: { id: 101, name: 'Next Tenant' },
    cost: 32000000,
    costPerDay: 1066666
  })], 4000);
  assert.equal(portfolio.currentObservedLease(history, 1).tenantName, 'Next Tenant');
  assert.equal(portfolio.previousLease(history, 1).tenantName, 'Tenant');
});

test('market distribution adds quartiles and per-day context without changing pricing', () => {
  const quote = {
    targetDays: 100,
    proposedTotal: 248750000,
    trustedMatches: [
      { equivalentTotal: 100000000 },
      { equivalentTotal: 200000000 },
      { equivalentTotal: 300000000 },
      { equivalentTotal: 400000000 }
    ]
  };
  const distribution = portfolio.marketDistribution(quote);
  assert.equal(distribution.q1Total, 175000000);
  assert.equal(distribution.medianTotal, 250000000);
  assert.equal(distribution.q3Total, 325000000);
  assert.equal(distribution.medianDaily, 2500000);
  assert.equal(distribution.proposedDaily, 2487500);
});
