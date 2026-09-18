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

  function extensionUrl(propertyId) {
    const id = asPositiveInt(propertyId);
    if (!id) throw new TypeError('A positive property ID is required');
    return `https://www.torn.com/properties.php#/p=options&ID=${id}&tab=offerExtension`;
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
    extensionUrl,
    uniquePropertyTypeIds
  });
}));
