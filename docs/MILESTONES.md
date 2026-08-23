# Milestones

Built in order. A milestone is not finished until it typechecks, lints, passes
its tests and has been exercised in a running application.

## Milestone 1 — Foundation ✅ complete

- [x] Architecture, module layout, documentation
- [x] Database schema: 49 tables, 24 enums, 123 foreign keys, 9 migrations
- [x] Row level security across every org-scoped table
- [x] Append-only audit log with database-level enforcement
- [x] Money, Result and profitability primitives with tests
- [x] Supabase clients (browser, request-scoped server, service role)
- [x] Authentication, session resolution, role guards, `proxy.ts`
- [x] Dashboard shell and thirteen working routes
- [x] Business settings with validation and a real Server Action
- [x] Demo mode: a complete simulated business through the real cost engine
- [x] Integration health reporting
- [x] Schema verification and type generation against a real Postgres engine

**Verified:** 23 unit tests pass; 9 migrations apply cleanly; all 13 routes
return 200 in demo mode with no console errors; `npm run check` is clean.

## Milestone 2 — Product intelligence ✅ complete

- [x] Provider-based research architecture (`src/lib/research/providers/`) with
      a typed interface, a declared descriptor (source type, credentials,
      rate limits, usage policy) and a registry that reports every planned
      provider — Amazon SP-API, Shopify Admin, a licensed trends dataset,
      TikTok Shop Partner API, a supplier feed — as `not_configured` until it
      genuinely has credentials and a written integration
- [x] Simulated research provider with six deliberately awkward candidates:
      a clean winner, a branded IP-risk case, a regulated lithium-battery
      product, a channel-divergent case, and a seasonal loss-maker
- [x] Opportunity lifecycle extended with `rejected` as a distinct terminal
      stage from `removed`, plus a state machine (`lifecycle.ts`) that
      refuses to skip the supplier and compliance gates, and an append-only
      `product_stage_transitions` history table
- [x] Opportunity scoring: 19 components, weights sum to 100, missing
      signals excluded and reweighted rather than defaulted, IP/regulatory
      risk hard-caps the total, confidence tracks both data coverage and
      source quality (simulated data cannot report high confidence)
- [x] Customer complaint analysis (11 themes, pattern-matched against
      sampled reviews) feeding a differentiation engine that proposes
      original, evidenced changes — never competitor text or images
- [x] Channel-aware profitability (`profitability/channels.ts`) that
      assembles Shopify vs Amazon cost assumptions and hands them to the
      *same* `calculateProfitability` engine from Milestone 1 — verified by
      a test that the channel module produces byte-identical output to
      calling the base engine directly
- [x] Compliance rule engine: per-check severity and remediability, so a
      missing certificate (fixable) is distinguished from a blocked category
      or high IP risk (a decision, not a task) — `canEnterLaunchQueue` is a
      hard gate no automation level can override
- [x] IP risk screening: brand authorisation, suspicious vocabulary,
      implausible pricing, restricted-brand list — always advisory, never a
      legal clearance
- [x] Identifier validation (`identifiers.ts`): real GS1 check-digit
      arithmetic verified against published reference barcodes, ISBN-10/13,
      ASIN shape checking — no function anywhere generates an identifier
- [x] Supplier scoring (cost, delivery, reliability, quality, returns,
      tracking, compliance capability) with independent Shopify/Amazon
      capability assessment, full CRUD with a real Server Action, and a
      cost-premium-vs-recommended distinction always shown in the UI
- [x] Dashboard Product Intelligence section, opportunity detail page (full
      profitability breakdown, per-channel compliance, supplier comparison,
      complaints, differentiation, score breakdown), research providers page,
      supplier detail/edit pages

**Verified:** 203 unit/integration tests pass (up from 23); 12 migrations
apply cleanly (54 tables, 29 enums, 139 foreign keys); all 19 routes return
200 in demo mode with no console errors; a supplier form submission was
driven through the browser and the Server Action's real capability
assessment ("Shopify would be review required, Amazon would be blocked")
was confirmed in the response; `npm run check` is clean.

**Known limitations**, stated plainly rather than glossed over:
- No live research provider exists yet. Every non-demo provider in the
  registry reports `not_configured` and refuses to run — this is the
  intended behaviour, not a gap to paper over.
- Opportunities and supplier scores are not yet persisted for a live
  (non-demo) org. `getOpportunities()` and `getSupplierDetail()` correctly
  return empty/null in live mode rather than fabricating data; the
  persistence path (writing `product_research`, `product_scores`,
  `opportunity_projections`, `differentiation_suggestions` rows from a real
  provider run) is Milestone 2's natural extension once a provider exists,
  and is deliberately not built ahead of having real data to write.
- The demo supplier model gives each supplier one flat unit cost across every
  product it supplies, which is a simplification — real supplier catalogues
  price per SKU.
- `changeProductStage` (the Server Action wrapping `planStageChange`) has not
  been exercised against a live Supabase project, only unit-tested and
  demo-mode-tested. The RLS split (history tables written via the service
  role) follows the same pattern as `saveSupplier`, which has been.

## Roadmap (revised)

The plan below supersedes the old Milestone 3–10 list further down this file's
git history. It reflects the fuller vision for Commerce OS as an increasingly
autonomous, multi-marketplace commerce operating system rather than a
single-store dropshipping tool. Read `docs/PRINCIPLES.md` before starting any
of these — every one of them is governed by it.

Build and verify each milestone before starting the next. Do not build ahead
of verified data: a UI or engine for data that does not exist yet (a live
provider, a connected marketplace) is exactly the kind of "mocked" work these
milestones exist to avoid.

## Milestone 3 — Supplier intelligence 🟡 in progress (connector interface complete)

- [x] Supplier connector interface (`src/lib/suppliers/connectors/types.ts`):
      a `SupplierConnector` mirroring the research provider architecture
      exactly — a declared descriptor (source type: api/feed/csv/manual/
      custom, required credentials, rate limits, usage policy), `isConfigured()`
      that can never lie about credentials it does not have, and
      `fetchStatus()` returning a `Result` so one failing connector never
      takes a run down. `SupplierProductStatus` covers every field Milestone 3
      asks for: cost, shipping, warehouse/country, stock and its freshness
      (`stockCheckedAt`), dispatch/delivery estimates, tracking, cancellation
      rate, fulfilment success rate, price-change detection, and
      documentation on file.
- [x] A real, working manual/CSV connector (`connectors/manual.ts`) — the one
      connector type that genuinely needs no credentials. It is not a
      placeholder: it computes real `SupplierProductStatus` values from the
      supplier data already in the system, and includes one seeded price
      increase so price-change detection has something genuine to find.
- [x] A connector registry (`connectors/registry.ts`) declaring seven planned
      categories — DSers-compatible sourcing, Syncee-type networks,
      EPROLO-type fulfilment, CJ-type sourcing, AutoDS-type aggregation, a
      direct supplier API, and a CSV/scheduled feed — every one reporting
      `not_configured` with its exact missing environment variables. Named
      with "-compatible"/"-type" throughout because none of these is an
      official partnership.
- [x] Price change history: `supplier_price_history` (append-only, same
      `forbid_mutation` trigger pattern as `audit_logs`), plus
      `detectPriceChange`/`detectPriceChanges` (`connectors/priceChanges.ts`)
      turning a connector's before/after cost pair into a signed percentage
      with a configurable significance threshold.
- [x] Supplier redundancy (`src/lib/suppliers/redundancy.ts`): given an
      unavailable preferred supplier and a set of alternatives, ranks them on
      the composite supplier score (never on price), re-checks only the two
      things that actually change with a different supplier — cost, through
      the single profitability engine, and channel capability — and applies
      the org's automation level. `manual`/`assisted` always request
      approval; `supervised`/`autonomous` may switch automatically, but only
      when the alternative preserves every channel the outgoing supplier was
      approved for and still clears the profitability gate there. An
      alternative that fails compliance is never auto-selected at any
      automation level.
- [x] `/suppliers/connectors` page (mirrors `/research`) and a worked
      "if this supplier becomes unavailable" panel on the supplier detail
      page, using the real demo data (Meridian Housewares' knife rail losing
      its only viable alternative to a supplier blocked for Amazon).
- [ ] Extending `SUPPLIER_WEIGHTS` with dedicated integration-quality,
      price-stability and stock-quality components. Not done in this pass —
      it would touch the tested Milestone 2 scoring formula, and the
      connector data needed to back those components with real signals
      (rather than a single demo price event) is more naturally built
      alongside a live connector.
- [ ] Persisting `supplier_connectors` / `supplier_connector_runs` for a live
      org. The tables exist and are RLS-verified (14 new tests); nothing
      writes to them yet, matching the same "no live provider, so no live
      data" honesty as Milestone 2's research providers.

**Verified:** 246 unit/integration tests pass (up from 203, +43); 14
migrations apply cleanly (57 tables, up from 54); all 19 routes (20 counting
the new opportunity/supplier detail routes) return 200 in demo mode with no
console errors; the connectors page was read live and confirmed the manual
connector's one genuine price-change detection (Northwind's desk lamp, +7.7%)
and every planned connector's honest `not_configured` status with exact
missing environment variables; the supplier detail redundancy panel was
confirmed live for the scenario supplier and confirmed absent for the other
two, proving it is not shown unconditionally. A pre-existing Milestone 2
cosmetic defect (unrounded supplier score components, e.g. "76.02739726027399")
was found and fixed while verifying this milestone's UI.

Do not claim a supplier integration exists unless an official API or a real,
permitted feed backs it; every connector with no real credentials reports
`not_configured`, exactly as the research providers do.

## Milestone 4 — Marketplace connector foundation ✅ complete

- [x] Marketplace connector interface (`src/lib/marketplaces/connectors/types.ts`),
      mirroring the Milestone 3 supplier connector interface exactly: a
      declared descriptor (capabilities, credentials, rate limits, usage
      policy), `isConfigured()` that cannot lie, and read methods
      (`fetchListings`, `fetchInventory`, `fetchOrders`, `fetchFees`,
      `getConnectionHealth`) each returning a `Result`.
- [x] Five-state connection status (`demo` / `not_configured` / `connected` /
      `degraded` / `error`) as its own enum, distinct from the seven-state
      `connector_status` used for suppliers — a marketplace connection is
      reported the way an owner actually thinks about it, not with the finer
      detail a scheduler needs.
- [x] A real Shopify Admin API connector (`connectors/shopify.ts`) —
      REST calls, bearer-token auth, gated behind `SHOPIFY_STORE_DOMAIN` /
      `SHOPIFY_ADMIN_ACCESS_TOKEN` / `SHOPIFY_API_VERSION`. **Implemented but
      not live-verified**: written against Shopify's published REST Admin API
      reference; never run against a real store.
- [x] A real Amazon Selling Partner API connector (`connectors/amazon.ts`)
      with a from-scratch AWS Signature Version 4 implementation
      (`connectors/amazonSigning.ts`, no AWS SDK dependency) and LWA token
      exchange. **Implemented but not live-verified**: the canonical-request
      structure matches the documented SigV4 algorithm and is covered by 12
      structural/determinism tests, but there is no seller account or SP-API
      application to confirm a byte-exact signature against, so this is
      explicitly not claimed as proven correct — see `tests/amazon-signing.test.ts`
      for exactly what was and was not verified.
- [x] Demo connectors for both channels (`shopifyDemo.ts`, `amazonDemo.ts`),
      always reporting `demo` status and returning real computed data derived
      from the same `PRODUCT_SEEDS` the rest of the demo business uses — not
      a static fixture.
- [x] Reconciliation engine (`src/lib/marketplaces/reconciliation.ts`):
      compares Commerce OS's own record against a marketplace snapshot for
      stock, price, listing status and order status, and reports a
      discrepancy with both values rather than silently trusting either side.
      The demo data includes one deliberate, real discrepancy (Shopify's
      reported stock for CMO-1001 is 33; Commerce OS's own record is still 41)
      that the engine genuinely finds — confirmed rendering live on the new
      Marketplaces page, not just in a test.
- [x] Idempotent webhook ingestion (`marketplaces/webhooks.ts` +
      `channel_webhook_events` with `unique (org_id, channel_id, external_event_id)`):
      a duplicate delivery is detected and recorded as ignored rather than
      reprocessed, including within a single burst-delivered batch.
- [x] Retry with exponential backoff (`marketplaces/retry.ts`): bounded
      attempts, a configurable retryable/non-retryable classifier (so a 401
      fails fast while a timeout retries), and a clean final failure rather
      than a thrown exception.
- [x] The publication gate (`marketplaces/publicationGate.ts`) — "a
      successful API connection does not publish anything by itself,"
      enforced in code: every publication is checked against product
      lifecycle rules, supplier status, supplier fulfilment capability, the
      profitability gate, channel-specific compliance, identifier
      requirements and automation permission, with each requirement reported
      individually. Composes the existing engines from Milestones 1-3
      (`products/lifecycle.ts`, `suppliers/scoring.ts`, the profitability
      engine, `compliance/rules.ts`) rather than recalculating any of them.
      Publishing without approval is only permitted at the `autonomous`
      automation level, and only once every other requirement has already
      passed — a guardrail that cannot be bypassed by raising the automation
      level, proven by a dedicated test.
- [x] Marketplace listing state machine (`marketplaces/listingLifecycle.ts`):
      `discovered → evaluating → approved → ready_to_list → pending_approval
      → published → paused/ended/blocked`, mirroring the product lifecycle
      state machine's structure — an `ALLOWED` transition map, a
      `planListingTransition` that refuses anything not on it, and an
      append-only `channel_listing_transitions` history table. Distinct from,
      and beneath, `channel_products.status` (the coarser status the rest of
      the app already renders).
- [x] New Marketplaces page (`/marketplaces`) showing both channels'
      connection status, listing/order counts, last successful/failed sync,
      inventory sync status, and open discrepancies with both sides' values
      — confirmed live to show Shopify as "Demo" (never "Connected") with a
      genuine "needs attention" flag from the one real discrepancy, and
      Amazon UK clean.
- [x] Migrations `0015_marketplace_connectors.sql`, `0016_rls_marketplace.sql`:
      extended the existing `channels`/`channel_products` tables (from
      Milestone 1) rather than duplicating them, plus `channel_sync_runs`,
      `channel_discrepancies`, `channel_webhook_events` (all append-only or
      read-only through RLS) and `channel_listing_transitions`. 61 tables, 16
      migrations.

**Verified:** 332 unit/integration tests pass (up from 246, +86); 16
migrations apply cleanly; typecheck, lint and build are clean; all 17+ routes
return 200 in demo mode with no console errors; the Marketplaces page and its
one deliberate discrepancy were confirmed rendering live in the browser;
`/api/health` and `/integrations` continue to report every real credential as
genuinely absent, with no regression from adding the new connector layer.

**Not implemented / explicitly out of scope for this milestone** (per the
brief: "do not build advertising yet... do not build full order fulfilment
yet"):
- Listing *write* operations (creating or updating a live Shopify/Amazon
  listing) are declared as capabilities but not called anywhere — this
  milestone is the read/reconciliation foundation Milestone 5 builds order
  orchestration on top of.
- Fee reporting for both real connectors returns an honest error rather than
  a guess: Shopify's requires the separate Payments/Payouts API, Amazon's
  requires the separate Finances API, neither of which is implemented.
- Amazon's real connector does not implement stock reporting (a separate FBA
  Inventory API call) or full listing price/stock (separate Pricing API
  calls) — `fetchListings` says so in its own `warnings` array rather than
  guessing at a number.
- No public webhook HTTP endpoint exists yet. The idempotency logic
  (`decideWebhookIngest`, `partitionWebhookBatch`) is built and tested, but
  wiring it to a real, signature-verified incoming webhook route needs live
  credentials to verify signatures against, so it is deferred rather than
  built as something that could not be tested honestly.
- `channel_sync_runs`, `channel_discrepancies`, `channel_webhook_events` and
  `channel_listing_transitions` are not persisted for a live org — same
  "no live data source, so no live writes" pattern as every prior milestone's
  connector layer.

**Blocked by credentials/API access:** live-verifying the Shopify and Amazon
connectors requires a real Shopify store and a real Amazon seller account
with an approved SP-API application respectively. Neither exists in this
environment; §6 of `HANDOVER.md` lists what the owner needs to provide.

## Milestone 5 — Order and fulfilment orchestration

The full order lifecycle: ingestion, validation, supplier selection, a
profitability re-check against live order economics, a compliance re-check
where the product's compliance basis has changed, fulfilment submission,
supplier acknowledgement, tracking, marketplace update, delivery monitoring,
returns and refunds, and financial reconciliation. Every retryable external
action is idempotent — the `idempotency_key` pattern already used for
`supplier_orders`, `invoices`, `refunds` and `inventory_movements` extends to
every new retryable write. Handle timeouts, duplicate webhooks, supplier
rejection, stock race conditions, missing tracking, partial fulfilment,
cancellation and refund as first-class cases, not exceptions to a happy path.
Build reconciliation jobs that detect when internal records disagree with a
marketplace or supplier.

- [x] Order status state machine (`orders/lifecycle.ts`): `pending → paid →
      awaiting_fulfilment → partially_fulfilled/fulfilled → delivered`, with
      `cancelled`/`refunded`/`partially_refunded`/`failed` reachable as
      first-class branches rather than exceptions. Reuses the existing
      `order_status` enum; mirrors the `ALLOWED` transition map +
      `planTransition` shape from `products/lifecycle.ts` and
      `marketplaces/listingLifecycle.ts`, plus a new append-only
      `order_status_transitions` history table.
- [x] Fulfilment status state machine (`fulfilment/lifecycle.ts`), same shape,
      keyed on `fulfilment_status` and a new `fulfilment_status_transitions`
      table. `failed` is deliberately **not** terminal here — unlike an order,
      a failed fulfilment can be retried against a different supplier via the
      redundancy evaluator built in Milestone 3.
- [x] Stock reservation with race-condition handling (`inventory/reservation.ts`):
      `reserveStock`, `releaseReservation` and a `reserveStockBatch` that
      processes requests in order and reports exactly which ones succeeded,
      partially succeeded, or failed against the remaining balance — the
      "two orders for the last unit" race is a named test case, not an
      afterthought.
- [x] Order validation and idempotent ingestion (`orders/validation.ts`,
      `orders/ingestion.ts`): `validateOrder` distinguishes fatal issues from
      warnings (a 5-minor-unit total-mismatch tolerance for rounding);
      `planOrderIngestion` returns `create | already_ingested |
      status_changed | rejected` so the same webhook delivered twice, or a
      status-only update, never creates a duplicate order.
- [x] Profitability re-check against live order economics
      (`orders/profitabilityRecheck.ts`): calls `calculateProfitability`
      directly — never a second, order-specific formula — because an order's
      real price and real supplier cost at fulfilment time can differ from
      the estimate the listing was approved against.
- [x] Compliance re-check (`orders/complianceRecheck.ts`): required when the
      fulfilling supplier differs from the one the listing was approved
      against, when product details have changed since approval, or when the
      last assessment is more than 90 days old. A supplier substitution never
      fulfils silently against a compliance basis that no longer applies.
- [x] Supplier selection for fulfilment (`fulfilment/selection.ts`): wraps the
      existing `rankSuppliers` engine from Milestones 2–3; prefers the
      already-approved supplier when it is also best-ranked, otherwise falls
      back to the best alternative with an explicit "this needs a compliance
      re-check" rationale attached to the choice.
- [x] Fulfilment submission gate (`fulfilment/submission.ts`), the order-side
      sibling of Milestone 4's `publicationGate.ts`: composes supplier
      selection, stock reservation, the profitability re-check, the
      compliance re-check and automation permission into named, individually
      reported requirements, then decides `submit_automatically |
      pending_approval | blocked`. Automation may auto-submit at `supervised`
      *or* `autonomous` here — looser than the publication gate's
      `autonomous`-only rule, because fulfilling an already-approved listing
      carries materially less downside than creating a new one — but, as with
      publication, a compliance or profitability failure blocks regardless of
      automation level, proven by dedicated tests.
- [x] Refund handling (`orders/refunds.ts`): a new
      `business_settings.max_auto_refund_minor` (default £50) gates
      auto-approval; manual/assisted automation always requires approval; a
      refund exceeding the order's remaining refundable balance is blocked
      regardless of automation level.
- [x] Delivery/tracking health (`fulfilment/tracking.ts`): flags missing
      tracking, stale status (no update in 5+ days), and overdue delivery as
      named, distinct conditions rather than one generic "problem" flag.
- [x] End-to-end orchestration (`orders/pipeline.ts`): `runOrderPipeline`
      threads ingestion → profitability re-check → compliance re-check →
      supplier selection → stock reservation → submission → delivery health
      in the documented order, composing every engine above without
      duplicating any of their logic.
- [x] Fulfilment-side marketplace update: `MarketplaceConnector.submitFulfilmentUpdate`
      added to the Milestone 4 connector interface, implemented for real
      against Shopify's `POST orders/{id}/fulfillments.json` and Amazon's
      SP-API shipment confirmation endpoint (the latter carries an explicit
      lower-confidence caveat — Amazon's shipment-confirmation surface has
      changed over time and should be checked against current SP-API docs
      before being relied on). Implementing this surfaced a real, pre-existing
      bug: both connectors' internal request helpers (`shopifyRequest`,
      `spApiRequest`) only supported GET, so a fulfilment "update" would
      silently have been a broken GET against a create-fulfilment endpoint —
      fixed by extending both to support a POST body.
- [x] Reconciliation extended to fulfilment (`marketplaces/reconciliation.ts`):
      `reconcileFulfilment` compares both fulfilment status and tracking
      number between our records and the marketplace's, following the same
      "record both values, resolve nothing automatically" pattern as the
      existing stock/price/order-status reconciliation.
- [x] Migrations `0017_order_orchestration.sql`, `0018_rls_order_orchestration.sql`:
      `order_status_transitions` and `fulfilment_status_transitions` (both
      append-only via `forbid_mutation`, read-only through RLS), plus
      `orders.risk_level`/`risk_assessed_at` and
      `business_settings.max_auto_refund_minor`. 63 tables, 18 migrations.
- [x] New Orders page (`/orders`) showing three demo order scenarios run
      through the real pipeline end to end, each isolating exactly one
      genuine failure mode: a clean happy path awaiting approval at the
      "assisted" automation level; an order whose approved supplier is
      unavailable, forcing a compliance re-check that fails; and a genuine
      stock shortfall with every other requirement passing. Each requirement
      the submission gate checked is listed individually with its own
      pass/fail reason, not collapsed into one verdict.

**Verified:** 424 unit/integration tests pass (up from 332, +92); 18
migrations apply cleanly against PGlite; typecheck, lint and build are clean;
all 20+ routes return 200 in demo mode; the new Orders page was confirmed
rendering live in the browser with all three scenarios showing their intended,
isolated failure mode and no console errors beyond the dev server's own HMR
websocket noise (unrelated to application code); `/marketplaces` and
`/approvals` continue to render with no regression from the new orchestration
layer.

**Not implemented / explicitly out of scope for this milestone:**
- The Approvals page does not yet have working approve/reject buttons wired
  to the new fulfilment submission gate — its copy already said "Approve and
  reject actions arrive with the automation engine in Milestone 5" from an
  earlier milestone, but wiring a click-through action that actually advances
  an order's state belongs with Milestone 6's formal action/audit pipeline,
  not this milestone's orchestration *logic*, so it was left as read-only.
- No order has ever been ingested from a real marketplace connector, because
  no live connector exists yet (Milestone 4's honest limitation) — so
  `order_status_transitions`, `fulfilment_status_transitions` and the new
  `business_settings.max_auto_refund_minor` column have no live-org rows to
  verify against; only demo data exercises them.
- Refund processing (`orders/refunds.ts`) decides whether a refund is
  permitted; it does not call any marketplace or payment provider to actually
  issue one — no payment provider connector exists yet.
- AWS SigV4 signing used by the Amazon fulfilment-update path remains
  verified only for internal structural correctness (canonical request
  shape, determinism), not against AWS's official signing test vectors — see
  §7 of `HANDOVER.md`.

**Blocked by credentials/API access:** live-verifying `submitFulfilmentUpdate`
against a real Shopify store or Amazon seller account requires the same real
accounts named as blocked in Milestone 4.

## Milestone 6 — Automation engine

A formal trigger → conditions → rules → decision → permission check → action
→ audit → monitoring pipeline, not automation logic scattered across cron
files. Every decision this engine makes is subject to the automation levels
in `docs/PRINCIPLES.md` §5 and produces an audit entry per §6. Job scheduling
is frequency-appropriate and respects declared provider rate limits — near
real-time for orders and inventory events where webhooks exist, 15–30 minutes
for reconciliation, hourly for supplier checks, daily for scoring and the CEO
briefing, weekly or slower for opportunity research. Frequency is configurable
per job, not assumed to always be "faster is better."

## Milestone 7 — Analytics and business intelligence

Revenue, orders, units, gross profit, contribution, contribution margin, ad
spend, CAC, ROAS, MER, refunds, returns, supplier/delivery/marketplace/product
performance, and cash movement, each clearly and separately defined — revenue,
cash received, gross profit, contribution and accounting profit are never used
interchangeably. Standard comparison periods (today, yesterday, this/last
week, month to date, previous month, custom range), and every comparison
states its comparison period explicitly.

## Milestone 8 — CEO dashboard

The dashboard the owner actually reads every day: an AI CEO briefing (every
claim traceable per the fact-first principle), a business pulse, an
explainable business health score, winners and losers, products ready to
scale (only when sales evidence, profitability, supplier capacity, returns,
compliance and advertising efficiency all clear their thresholds), an
attention-required section, an automation centre, a finance centre (VAT
tracked, not filed — never presented as tax advice), supplier and advertising
command centres, a product testing centre, a system health panel (connectors,
workers, last sync, failed jobs), and an emergency stop that can pause
automation categories while preserving critical order processing, itself
logged like any other consequential action.

## Milestone 9 — Commerce Intelligence chat

An AI chat interface answering real questions about the actual business
through a controlled tool/query layer with explicit per-tool permissions —
never raw, unrestricted database access. Responses follow the fact-first
categories (facts, calculations, rules, analysis, predictions, uncertainty)
and the system can say "I don't have enough current data to answer that
reliably." Credentials never enter conversational memory.

## Milestone 10 — AI actions

Four interaction modes — ask, analyse, recommend, execute — where "execute"
still passes through the same automation-level and approval machinery as any
other action. The AI is never the source of authority: rules, permissions,
validation and the action layer built in Milestones 5–6 remain authoritative
regardless of what the AI recommends.

## Milestone 11 — Advertising intelligence

Advertising platform integrations (Amazon Ads, Meta, Google, TikTok as
applicable) evaluated on contribution after advertising, never on ROAS alone —
a campaign can carry high revenue or a strong ROAS and still be unprofitable
once real costs are included. Automated advertising actions carry account,
daily and per-product limits, maximum percentage changes, approval thresholds,
cooldowns, rollback logic and audit logging, with no path to unlimited
automated spend.

## Milestone 12 — International expansion

Country/marketplace/currency/tax/shipping/documentation modelled explicitly,
with product-marketplace eligibility, supplier delivery capability, delivery
acceptability, profitability, documentation and tax configuration each
assessed independently per destination. Unknown resolves to review, never to
approval, exactly as in Milestone 2's compliance model.

## Cross-cutting, ongoing

These are not single milestones — they are requirements that apply across all
of the above and should be revisited at every milestone boundary:

- **Finance, invoicing and tax**: preserve the immutable-invoice and
  append-only principles from Milestone 1; VAT/tax features track, calculate
  from configured rules, remain auditable, and are never presented as
  professional tax advice.
- **Payments and cashflow**: model the real gap between a marketplace sale, a
  processor settlement, fees, refunds, chargebacks, and outgoing supplier/ad/
  tax payments — gross sales are never treated as cash available, and every
  forecast is labelled as a forecast.
- **Reliability**: idempotency, retries with backoff, reconciliation, health
  monitoring, explicit stale-data detection, and the existing database
  constraints and append-only records are the tools — the system is never
  described as bulletproof, because external systems (marketplace APIs,
  suppliers, networks) fail in ways it must detect and manage, not assume
  away.
- **Central Intelligence**: an orchestration layer combining data,
  calculations, rules, specialist engines, AI reasoning and automation
  policy — never a single "magic" AI function. Deterministic calculations
  and compliance gates never depend solely on AI reasoning.
