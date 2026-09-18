'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const build = require('../scripts/build-userscript');

const root = path.resolve(__dirname, '..');

function release() {
  return build.buildText();
}

test('release userscript has narrow Torn properties metadata and v0.4.1 version', () => {
  const source = release();
  assert.match(source, /@name\s+R4G3RUNN3R Property Rental Manager/);
  assert.match(source, /@version\s+0\.4\.1/);
  assert.match(source, /@match\s+https:\/\/www\.torn\.com\/properties\.php\*/);
  assert.match(source, /@connect\s+api\.torn\.com/);
  assert.match(source, /@grant\s+GM_xmlhttpRequest/);
  assert.doesNotMatch(source, /@match\s+https:\/\/www\.torn\.com\/\*/);
});

test('release supports one explicit LIST PROPERTY click without automatic form submission APIs', () => {
  const source = release();
  assert.doesNotMatch(source, /\.submit\s*\(/);
  assert.doesNotMatch(source, /\.requestSubmit\s*\(/);
  assert.match(source, /function submitLeaseFromUserGesture/);
  assert.match(source, /submitButton\.click\(\)/);
  assert.match(source, /data-action['"]?:?\s*['"]list-property|createButton\('LIST PROPERTY', 'list-property'\)/);
  assert.match(source, /if \(action === 'list-property'\)/);
});

test('release verifies staged visible Torn values before LIST PROPERTY can submit', () => {
  const source = release();
  assert.match(source, /function verifyPreparedLeaseForm/);
  assert.match(source, /Prepared lease values changed; press PREPARE RENTAL again/);
  assert.match(source, /R4G3FormCore\.verifyPreparedLeaseForm/);
  assert.match(source, /PREPARE RENTAL/);
  assert.match(source, /READY TO LIST/);
  assert.match(source, /\['input', 'change', 'keyup', 'blur'\]/);
});

test('release never places an API key in a URL', () => {
  const source = release();
  assert.doesNotMatch(source, /[?&](?:key|apiKey)=/i);
  assert.doesNotMatch(source, /apiKey\s*\}\s*[&?#]/);
  assert.match(source, /Authorization:\s*`ApiKey \$\{apiKey\}`/);
});

test('userscript network adapter rejects non-api.torn.com requests', () => {
  const source = release();
  assert.match(source, /url\.origin !== R4G3ApiCore\.API_ORIGIN/);
  assert.match(source, /Rejected non-Torn API request/);
  assert.doesNotMatch(source, /fetch\s*\(\s*['"`]https:\/\/www\.torn\.com/i);
  assert.doesNotMatch(source, /GM_xmlhttpRequest\s*\(\s*\{[^}]*url:\s*['"`]https:\/\/www\.torn\.com/is);
});

test('release keeps PREPARE RENTAL draft armed until explicit verified LIST PROPERTY', () => {
  const source = release();
  assert.match(source, /R4G3FormCore\.parseLeasePropertyId/);
  assert.match(source, /R4G3FormCore\.prepareLeaseForm/);
  assert.match(source, /function createLeaseLister/);
  assert.match(source, /canListProperty\(propertyId\)/);
  assert.match(source, /listProperty\(propertyId\)/);
  assert.match(source, /R4G3FormCore\.submitLeaseFromUserGesture/);
  assert.match(source, /draftStore\.clear\(\)/);
  assert.match(source, /MutationObserver/);
});

test('release contains current exact-match 100-day pricing and strategy controls', () => {
  const source = release();
  assert.match(source, /body\.rentals\.listings/);
  assert.match(source, /function exactModificationMatch/);
  assert.match(source, /function rentalQuote/);
  assert.match(source, /targetDays:\s*TARGET_DAYS/);
  assert.match(source, /pricingBasis/);
  assert.match(source, /Lowest market price/);
  assert.match(source, /Median market price/);
  assert.match(source, /Average market price/);
  assert.match(source, /Highest market price/);
  assert.match(source, /r4g3-prm-settings-window/);
  assert.match(source, /LISTED FOR RENT/);
});

test('release protects exact-match pricing from extreme normalized market outliers', () => {
  const source = release();
  assert.match(source, /function filterEquivalentPriceRows/);
  assert.match(source, /median\s*\/\s*5/);
  assert.match(source, /median\s*\*\s*5/);
  assert.match(source, /1\.5\s*\*\s*iqr/);
  assert.match(source, /price_data_too_inconsistent/);
  assert.match(source, /insufficient_market_sample/);
  assert.match(source, /Outliers ignored:/);
  assert.match(source, /Exact matches:/);
  assert.match(source, /Used:/);
});

test('release paces UPDATE ALL sequentially and renders a global progress bar', () => {
  const source = release();
  assert.match(source, /BULK_MARKET_DELAY_MS\s*=\s*1500/);
  assert.match(source, /scanOptions\.sequential\s*=\s*true/);
  assert.match(source, /betweenMarketsMs/);
  assert.match(source, /v037-update-all-progress/);
  assert.match(source, /role['"],\s*['"]progressbar/);
  assert.match(source, /Updating rental markets…/);
});

test('release automatically syncs owned properties without automatically scanning rental markets', () => {
  const source = release();
  assert.match(source, /function syncOwnedProperties\(\)/);
  assert.match(source, /load:\s*syncOwnedProperties/);
  assert.match(source, /fetchOwnedProperties\(\)/);
  assert.match(source, /normalizeProperties\(rawProperties, currentUserId\)/);
  assert.match(source, /Promise\.resolve\(\)\.then\(\(\) => syncOwnedProperties\(\)\)/);
  assert.match(source, /Object\.assign\(\{\}, existing \|\| \{\}, \{ autoPageUpdate: false \}\)/);
  assert.match(source, /SCAN MARKET/);
  assert.match(source, /Rental-market scans are always manual/);
  assert.match(source, /v035-update-progress/);
  assert.match(source, /v034-update-property/);
  assert.match(source, /UPDATE ALL/);
});

test('release paginates large rental markets with total plus offset and exposes page-level progress', () => {
  const source = release();
  assert.match(source, /function metadataTotal/);
  assert.match(source, /function offsetUrl/);
  assert.match(source, /searchParams\.set\('limit', String\(PAGE_LIMIT\)\)/);
  assert.match(source, /searchParams\.set\('offset'/);
  assert.match(source, /Math\.ceil\(total \/ PAGE_LIMIT\)/);
  assert.match(source, /onPageProgress/);
  assert.match(source, /v039-market-page-progress/);
  assert.match(source, /Searching rental market…/);
  assert.match(source, /listings/);
});

test('release uses truthful cache-aware cancellable scans with retry diagnostics', () => {
  const source = release();
  assert.match(source, /PAGE_WORKERS\s*=\s*2/);
  assert.match(source, /function sameRentalTimestamp/);
  assert.match(source, /rentals_timestamp/);
  assert.match(source, /unchanged:\s*true/);
  assert.match(source, /Property checked:/);
  assert.match(source, /Market checked:/);
  assert.match(source, /propertyCheckedAt/);
  assert.match(source, /marketCheckedAt/);
  assert.match(source, /CANCEL SCAN/);
  assert.match(source, /v0310-request-status/);
  assert.match(source, /onRequestStatus/);
  assert.match(source, /AbortError/);
  assert.match(source, /requestHandle\.abort\(\)/);
});

test('release cancellation is explicit, native and fail-closed', () => {
  const source = release();
  assert.match(source, /function findRentalCancelButton/);
  assert.match(source, /function canCancelRentalListing/);
  assert.match(source, /function cancelRentalListingFromUserGesture/);
  assert.match(source, /CANCEL LISTING/);
  assert.match(source, /CONFIRM CANCEL LISTING/);
  assert.match(source, /FINAL CONFIRM CANCEL/);
  assert.match(source, /findRentalCancelConfirmationButton/);
  assert.match(source, /CANCELLATION SENT/);
  assert.match(source, /Active lease cannot be cancelled/);
  assert.match(source, /button\.click\(\)/);
});

test('release enforces shared 80 per minute and 750ms Torn API pacing', () => {
  const source = release();
  assert.match(source, /minGapMs:\s*750/);
  assert.match(source, /maxPerMinute:\s*80/);
  assert.match(source, /Request limit: 80 \/ minute/);
  assert.match(source, /Minimum spacing: 750 ms/);
  assert.match(source, /RATE_LIMIT_COOLDOWN_MS\s*=\s*60\s*\*\s*1000/);
});

test('build script declares every shipped source module in deterministic order', () => {
  const expected = [
    'src/property-core.js',
    'src/market-core.js',
    'src/api-core.js',
    'src/draft-core.js',
    'src/form-core.js',
    'src/settings-core.js',
    'src/update-core.js',
    'src/ui-observer.js',
    'src/app-runtime.js',
    'src/bootstrap.js'
  ];
  assert.deepEqual(build.sourceFiles, expected);
  assert.equal(build.sourceFiles.some(file => /^src\/app-v\d+\.js$/.test(file)), false);
  assert.equal(build.sourceFiles.includes('src/app.js'), false);

  const buildPath = path.join(root, 'scripts', 'build-userscript.js');
  const source = fs.readFileSync(buildPath, 'utf8');
  assert.doesNotMatch(source, /sourceFiles\s*=\s*\[[^\]]*src\/api-core-v\d+/s);
  assert.doesNotMatch(source, /sourceFiles\s*=\s*\[[^\]]*src\/ui-core-v\d+/s);
  assert.doesNotMatch(source, /sourceFiles\s*=\s*\[[^\]]*src\/update-core-v\d+/s);
});
