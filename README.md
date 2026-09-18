# Torn Property Rental Manager

A standalone Torn.com userscript by **R4G3RUNN3R** for pricing and managing properties you own using Torn's rental market.

## Install / Update

Install the current userscript from:

`https://voidsmithindustries.com/torn/install/property-rental-manager.user.js`

Tampermonkey-compatible update metadata points to the same Voidsmith Industries website distribution. The project is released under the MIT License; see `LICENSE`.

## v0.4.1

v0.4.1 is a distribution-only patch. Runtime behavior is unchanged from v0.4.0; install and future update checks now use the Voidsmith Industries website instead of GitHub raw delivery.

## v0.4.0

v0.4.0 is an **architecture and maintainability release**. Its goal is to preserve the proven v0.3.10 behavior while removing version-chained runtime modules and reducing duplicate DOM observation work.

The manager still automatically loads and verifies **your owned properties** without scanning Torn's rental market. Market pricing remains deliberate: **SCAN MARKET** for one property or **UPDATE ALL** for all relevant property types.

### Architecture changes in v0.4.0

The shipped userscript now has a stable runtime module list:

- `property-core.js`
- `market-core.js`
- `api-core.js`
- `draft-core.js`
- `form-core.js`
- `settings-core.js`
- `update-core.js`
- `ui-observer.js`
- `app-runtime.js`
- `bootstrap.js`

The old API, settings and update wrappers are no longer shipped as runtime layers. Their behavior now lives in the stable core modules.

The historical `app-v*` source files remain in the repository temporarily as **regression fixtures and migration source**, but they are no longer independent entries in the shipped module list. The build composes their already-tested behavior into one stable `app-runtime` block.

`ui-observer.js` multiplexes the internal app UI observers through **one app-level native MutationObserver**. This preserves the existing UI behavior while avoiding several independent native observers watching the same document. Bootstrap remains separate because it owns the narrow Torn/native integration boundary.

Storage keys are preserved. Upgrading to v0.4.0 does **not** intentionally reset the saved API key, pricing preferences, appearance settings, snapshots, or property/market timestamps.

### Preserved v0.3.10 behavior

- separate **Property checked** and **Market checked** timestamps
- automatic owned-property sync with **zero automatic rental-market requests**
- exact property type + exact modification matching
- 100-day normalized pricing
- Lowest / Median / Average / Highest pricing bases
- default **Average minus 0.5%** pricing
- outlier protection and tiny-sample fail-closed behavior
- timestamp-aware first-page market checks
- at most two market-page workers
- **CANCEL SCAN** with real request abort where supported
- retry and Torn rate-limit diagnostics
- sequential **UPDATE ALL** with a 1.5-second inter-market pause
- safe **PREPARE RENTAL -> LIST PROPERTY** workflow
- explicit staged listing cancellation
- 750 ms request spacing, 80 requests per rolling minute and 60-second rate-limit cooldown
- API-owner verification and fail-closed native actions

## Market matching and pricing

The pricing engine compares only rental listings for the **same property type with the exact same upgrades/modifications**, normalizes every comparable to an equivalent **100-day total**, filters statistically extreme prices, and then uses the selected pricing basis.

`100-day equivalent = (listing total cost / listing rental period) * 100`

Available pricing bases:

- **Lowest market price**
- **Median market price**
- **Average market price**
- **Highest market price**

The default proposed rent is **Average market price minus 0.5%**, rounded down to a whole dollar.

### Outlier protection

Outlier protection is always enabled.

- With three or more exact matches, normalized prices outside **median / 5 through median * 5** are excluded first.
- With at least four remaining trusted rows, a **1.5x IQR** filter removes remaining statistical extremes.
- With exactly two exact matches more than **5x apart**, the sample is reported as **PRICE DATA TOO INCONSISTENT** and no automatic price is proposed.
- With one exact match, the card reports **INSUFFICIENT MARKET SAMPLE** and no automatic price is proposed.
- Cards display **Exact matches / Used / Outliers ignored**.

Changing pricing basis or undercut recalculates already-loaded market data immediately and does not require another market request.

## Updates and scanning

### Automatic owned-property refresh

When the manager starts or opens it:

1. verifies the current Torn API user;
2. fetches that user's owned properties;
3. rejects rows whose ownership cannot be verified as belonging to that API user;
4. renders the owned-property cards;
5. advances **Property checked** for verified properties;
6. makes **zero rental-market requests**;
7. preserves the previous successful **Market checked** time and saved market snapshot.

Property discovery and market pricing are intentionally separate operations.

### Individual SCAN MARKET

**SCAN MARKET**:

1. refreshes the verified owned-property state needed for that property;
2. starts a cancellable scan only for that property's matching rental-market type;
3. fetches the first 100-row market page;
4. compares Torn's `rentals_timestamp` with the saved complete snapshot;
5. reuses the saved complete snapshot when the market timestamp is unchanged;
6. otherwise fetches remaining offset pages with at most two page workers;
7. shows page/listing progress and retry/cooldown diagnostics;
8. records **Market checked** only after a successful scan.

Other property cards retain their own previous market snapshots until explicitly scanned.

### Cancelling a scan

While an individual market scan is active, the card exposes **CANCEL SCAN**.

Cancellation:

- aborts the active request when the transport supports it;
- prevents additional queued market pages from starting;
- propagates as `AbortError`;
- does not overwrite the last good rental-market snapshot;
- does not advance **Market checked**;
- can still preserve a successful **Property checked** timestamp when ownership/status verification completed first.

### UPDATE ALL

**UPDATE ALL** is an explicit bulk action.

- Unique property types are processed sequentially.
- Bulk scans pause **1.5 seconds between completed property-type scans**.
- Every Torn request still obeys the shared **750 ms minimum spacing** and **80 requests per rolling minute** ceiling.
- Large markets use the same timestamp-aware first-page check and bounded page workers.
- A global progress bar reports completed property-type markets.
- UPDATE ALL is never started automatically by page load or a legacy Automatic preference.

## Rental listing workflow

For an available property with a trustworthy quote:

1. **PREPARE RENTAL** stores the exact proposed 100-day total, opens the matching Torn lease page, and fills Torn's visible rental-period and total-cost inputs.
2. **LIST PROPERTY** is a second explicit user action. It verifies the route, draft, visible values and native Torn listing control before clicking Torn's native final button exactly once.

If the Torn days or total are changed after preparation, LIST PROPERTY refuses to submit and leaves the edited values untouched. PREPARE RENTAL must be pressed again deliberately.

No page load, timer, MutationObserver, refresh, retry callback or form-preparation step may trigger the native final listing action.

## Cancelling a property listing

For a verified **for_rent** property:

1. Press **CANCEL LISTING**.
2. The script waits for Torn's native remove-from-market control.
3. When recognized and enabled, the action becomes **CONFIRM CANCEL LISTING**.
4. Only that explicit action may click Torn's native remove control.
5. If Torn presents another confirmation dialog, **FINAL CONFIRM CANCEL** is required.
6. The card then shows **CANCELLATION SENT** until the property is deliberately refreshed.

A property whose status is **rented** does not receive a cancel-listing action.

## Interface and settings

The manager supports:

- movable/resizable desktop panel
- mobile-safe layout
- minimize / close / launcher restore
- movable/resizable Settings window
- Dark / Light theme
- Comfortable / Compact card density
- Show / Hide property images
- Full / Compact market detail
- property sorting by recommended order, name, rent, happiness or ID

Properties listed for rent remain in the bottom status group. A property successfully listed during the current session moves there immediately.

## Torn API safety

The API key remains browser-local, is never rendered back into an input, and is sent only in the `Authorization: ApiKey ...` header to `api.torn.com`.

Hard request controls:

- maximum **80 request starts per rolling 60 seconds**
- minimum **750 ms** between Torn API request starts
- maximum **two active page workers** inside one changed rental market
- UPDATE ALL processes unique property-type markets **sequentially**
- UPDATE ALL waits **1.5 seconds between completed property-type scans**
- **60-second cooldown** after Torn error 5 / Too many requests before bounded retry
- bounded retry for transient network failures and HTTP 429/502/503/504 responses
- pagination continuation URLs accepted only from `https://api.torn.com/v2/`
- API-owner identity verification rejects spouse-owned, other-player-owned and unverified-owner property rows

## Release history

### v0.4.0

- Consolidated API behavior into stable `api-core.js`.
- Consolidated pricing/display settings into stable `settings-core.js` without changing the existing settings storage key.
- Consolidated update/snapshot state into stable `update-core.js` without changing the existing snapshot/update keys.
- Added `ui-observer.js` to multiplex internal app observers through one app-level native MutationObserver.
- Added stable `app-runtime.js` as the only shipped app runtime entry.
- Removed version-numbered app files from the shipped module list while retaining them temporarily as regression fixtures.
- Bumped the generated userscript and package metadata to 0.4.0.

### v0.3.10

- Split property and market timestamps.
- Added timestamp-aware unchanged-market reuse, cancellation, retry diagnostics and bounded market-page workers.

### v0.3.9

- Added total/offset pagination for large rental markets and live page/listing progress.

### v0.3.8

- Added automatic owned-property discovery with zero automatic rental-market requests and explicit per-property SCAN MARKET.

### v0.3.7

- Made UPDATE ALL sequential by property type with a 1.5-second inter-market pause and global progress.

### v0.3.6 and earlier

- Added outlier protection, per-property market isolation, staged cancellation, safe rental listing, shared API pacing, snapshots, sorting, appearance controls and ownership verification.

## Install

Install the generated userscript:

`R4G3RUNN3R-Property-Rental-Manager.user.js`

For the v0.4.0 deployment/rollback checklist, see `docs/V0.4.0-MIGRATION.md`.
