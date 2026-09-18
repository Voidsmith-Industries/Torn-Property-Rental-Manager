# Torn Property Rental Manager Design

## Goal

Build a standalone Torn userscript that scans properties the user already owns, compares current rental-market listings through the official Torn API, recommends competitive lease pricing, and prepares one visible native Torn lease form after an explicit user action.

## Compliance boundary

Automatic behavior is limited to Torn API reads, local calculations, local persistence, UI rendering, and input-field preparation on the actively viewed Torn page. The script must not submit a lease automatically, programmatically click Torn action controls that cause a request, issue background non-API Torn requests, bypass CAPTCHA, scrape unrelated Torn pages, or send telemetry.

## Repository layout

- `src/property-core.js` - owned-property normalization and status/eligibility helpers
- `src/market-core.js` - comparable scoring, outlier filtering, price statistics and recommendations
- `src/api-core.js` - Torn v2 API client and shared rate scheduler
- `src/draft-core.js` - one pending lease draft in sessionStorage
- `src/form-core.js` - visible native lease form detection and safe field preparation
- `src/app.js` - userscript UI/orchestration
- `tests/*.test.js` - Node 20 tests
- `R4G3RUNN3R-Property-Rental-Manager.user.js` - installable bundled userscript

## API requirements

- Owned properties: Torn v2 `/user/properties` (Limited access; current rental fields also provide v1 landlord attention/history observations)
- Rental market: Torn v2 `/market/{propertyTypeId}/rentals`
- API key is sent only as `Authorization: ApiKey {key}` to `https://api.torn.com`
- Minimum 800 ms between API request starts
- Hard maximum 75 API request starts per rolling 60 seconds
- Follow pagination only while continuation URLs remain on `api.torn.com` and under `/v2/`
- Rental-market cache per property type; respect API cache timing when available, otherwise 15-minute fallback

## Property rules

Normalize owned records into:

`{ id, propertyTypeId, name, ownerId, happy, status, modifications, raw }`

Only status `none` is eligible for a new lease draft. `in_use`, `for_sale`, `rented`, and `for_rent` are non-actionable for a new listing.

Native lease route:

`https://www.torn.com/properties.php#/p=options&ID={propertyId}&tab=lease`

## Comparable scoring

Same property type only.

`happyScore = max(0, 1 - abs(listingHappy - ownedHappy) / max(ownedHappy, 1))`

Modification similarity uses Jaccard set similarity, with `1` when both sets are empty.

`similarity = happyScore * 0.7 + modificationScore * 0.3`

Selection tiers:

1. similarity >= 0.90
2. widen to >= 0.75 if fewer than 5
3. if still fewer than 5, top 10 same-type listings by similarity
4. maximum 30 comparables

## Price statistics

Use positive `cost_per_day` values. When at least four values exist, apply Tukey IQR filtering. If filtering would leave fewer than three prices, keep the untrimmed set.

Expose floor, Q1, median, Q3, sample size, average similarity, confidence and suggested daily price.

Default pricing:

- undercut = 0.5%
- minimum median ratio = 0.70

`suggestedDaily = max(floor(marketFloor * (1 - undercut/100)), floor(median * minimumMedianRatio))`

Confidence:

- High: >= 8 cleaned comparables and average similarity >= 0.90
- Medium: >= 5 cleaned comparables and average similarity >= 0.75
- Low: otherwise

## v1 landlord operations

v1 adds an operational landlord layer without changing the pricing or native-action safety authorities.

- **Attention states:** vacant, urgent 0-3d, expiring 4-7d, due soon 8-14d, active, listed and extension offered.
- **Search:** property name/ID and renter name/ID.
- **Lease history:** browser-local observations from successful owned-property refreshes only. No Full Access user-log dependency and no claims about pre-install history.
- **Market explanation:** quartile and per-day context is derived from the already filtered trusted exact-comparable set; it does not alter pricing.
- **Backup:** only allowlisted local settings and observed lease history are exportable. API keys and market caches are excluded; import preserves the existing API key.
- **Extension boundary:** the manager may navigate to Torn's native `offerExtension` route after an explicit user click. It must not submit the extension.
- **PDA/mobile:** landlord search/filter/actions must remain usable at narrow widths with touch-size controls.

## Lease draft

One pending draft is stored in sessionStorage under `r4g3_property_rental_manager.pending_lease`.

Defaults and validation:

- rental period 30 days
- valid range 1-365 days
- positive integer daily price
- `totalCost = days * dailyPrice`
- default expiry 30 minutes
- draft must match the property ID in the current lease route

## Native form preparation

Known route:

`#/p=options&ID={id}&tab=lease`

Known form area:

- `#market ul.lease-input`
- days: `li.amount input.input-money:not([type=hidden])`
- cost: `li.cost input.lease.input-money`

The integration must set values through the native input setter and dispatch `input` and `change` events. It must never submit the form or click the native submit control. If selectors fail, show `Form not recognized` and leave the page unchanged.

## UI

Follow the user's current Torn tool conventions:

- movable and resizable desktop shell
- persistent geometry
- Simple and Advanced modes
- dark mode uses readable off-white/neon-green accents, never black-on-dark text
- light mode uses dark text
- responsive mobile fallback
- local-only settings/cache

Simple mode shows actionable essentials. Advanced mode adds quartiles, sample counts, average similarity, modifications, timestamps, pricing controls, cache controls, and diagnostics.

## Acceptance criteria

1. Manager loads only on `https://www.torn.com/properties.php*`.
2. Owned property statuses load through Torn API.
3. Markets are scanned only for unique owned property types.
4. Empty properties receive comparable-backed pricing recommendations.
5. Prepare Lease is one explicit user action for one property.
6. Native lease form fields are prepared but never submitted automatically.
7. API pacing and key handling are enforced centrally.
8. Dark/light themes and Simple/Advanced modes are readable.
9. Desktop panel is movable/resizable and geometry persists.
10. Automated tests and syntax checks pass.

## Non-goals for v1

No property purchase scanning, auto-buying, automatic lease submission, automatic repricing, automatic lease-extension submission, external backend, or background notification scraping.