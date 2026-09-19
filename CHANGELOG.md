# Changelog

All notable changes to Torn Property Rental Manager are recorded here.

## [1.0.1] - 2026-09-19

### Refresh/update freeze hotfix

- Fixed the v1 landlord observer reacting to unrelated Torn-page child-list churn during refresh/update activity.
- Avoided recalculating and sorting an already-rendered trusted market distribution on subsequent manager DOM mutations.
- Added regression coverage proving unrelated Torn DOM churn is ignored and existing market distributions are not recomputed.
- Preserved pricing, scan semantics, v1 landlord features and the shared 750 ms / 80-per-minute API scheduler.

## [1.0.0] - 2026-09-19

### Landlord operations

- Added portfolio attention counts and filters for vacant, urgent, expiring, due-soon, active, listed and extension-offered properties.
- Added property/renter search by name or ID.
- Added current lease context with renter, days remaining, rent/day and extension status.
- Added browser-local observed lease history without requiring Full Access Torn logs.
- Added explicit navigation to Torn's native extension screen for eligible expiring leases; no extension is submitted automatically.

### Market transparency

- Added P25, median and P75 distribution context plus per-day equivalents over the existing trusted exact-comparable set.
- Preserved the existing pricing formula, outlier protections, sample-quality gates and manual market-scan model.

### Local data and mobile

- Added versioned local export/import for settings and locally observed lease history.
- API keys and disposable market cache are excluded from exported backups; importing preserves the browser's current API key.
- Added touch-sized landlord controls and single-column attention controls for PDA/mobile widths.

### Security and compatibility

- Preserved Limited-access property data as the lease-history authority.
- Preserved explicit PREPARE RENTAL -> LIST PROPERTY and multi-confirm cancellation boundaries.
- Added no background native Torn action, telemetry, external backend, or Full Access key dependency.

## [0.4.2] - 2026-09-18

### Presentation

- Added the dedicated Voidsmith house icon to the userscript metadata.
- Preserved the existing website-hosted install/update authority and rental behavior.

## [0.4.1] - 2026-09-18

### Distribution

- Moved public install/update authority to https://voidsmithindustries.com/torn/install/property-rental-manager.user.js.
- Replaced GitHub-based userscript namespace/support metadata with Voidsmith website destinations.
- Runtime behavior is unchanged from v0.4.0.

## [0.4.0] - 2026-08-24

### Architecture

- Consolidated the final paginated/cache-aware API implementation into stable `src/api-core.js`.
- Consolidated pricing/display preferences into stable `src/settings-core.js` while preserving the existing settings key.
- Consolidated update/snapshot state into stable `src/update-core.js` while preserving the existing update and snapshot keys.
- Added `src/ui-observer.js`, a MutationObserver multiplexer that lets the internal application layers share one app-level native observer.
- Added stable `src/app-runtime.js` as the only shipped application-runtime entry.
- Removed `app-v*.js`, `api-core-v*.js`, `ui-core-v*.js`, and `update-core-v*.js` from the shipped `sourceFiles` list.
- Historical app wrapper sources remain temporarily in-repository as behavior/regression fixtures while v0.4.0 is validated.

### Compatibility

- Preserved v0.3.10 localStorage keys and snapshot shapes.
- Preserved browser-local API key handling.
- Preserved existing pricing settings, sorting, appearance settings, cached markets, property snapshots, and property/market timestamps.
- Preserved the explicit manual market-scan model: startup property sync does not automatically scan Torn rental markets.

### Safety and behavior retained

- Exact property type and exact modification matching.
- 100-day normalized pricing with selectable Lowest, Median, Average, or Highest basis.
- Default Average minus 0.5% proposed rent.
- Outlier filtering and fail-closed tiny/inconsistent samples.
- Timestamp-aware unchanged-market reuse.
- Two-worker maximum for changed market pagination.
- Cancellable per-property scans and retry/rate-limit diagnostics.
- Sequential UPDATE ALL with 1.5-second pauses between property-type markets.
- 750 ms minimum Torn API request spacing and 80 request starts per rolling minute.
- Safe PREPARE RENTAL -> LIST PROPERTY flow with visible-value verification.
- Explicit multi-step cancellation flow for properties listed for rent.
- API-owner verification and fail-closed Torn native actions.

### Release engineering

- Added v0.4.0 architecture regression tests.
- Added a stable-runtime smoke test.
- Synchronized the generated userscript and package lockfile to version 0.4.0.
- Added `docs/V0.4.0-MIGRATION.md` with deployment and rollback gates.

## [0.3.10]

- Added separate Property checked and Market checked timestamps.
- Added timestamp-aware first-page market checks and unchanged snapshot reuse.
- Added bounded two-worker pagination, scan cancellation, and retry/cooldown diagnostics.

## [0.3.9]

- Added total/offset pagination for large rental markets and page/listing progress.

## [0.3.8]

- Added automatic owned-property discovery with zero automatic rental-market requests.
- Added explicit per-property SCAN MARKET.

## [0.3.7]

- Added sequential UPDATE ALL and global progress.

## [0.3.6 and earlier]

- Added outlier protection, per-property market isolation, safe staged rental listing/cancellation, snapshots, settings, sorting, appearance controls, API pacing, and ownership verification.
