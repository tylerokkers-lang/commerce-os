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

- [x] Automation levels formalised as a policy layer (`automation/policyEngine.ts`):
      one function, `evaluateAutomationPolicy`, is the only place the kill
      switch, category pauses and financial/percentage limits are checked.
      It takes a domain engine's own verdict (blocked / pending_approval /
      auto_permitted) and only ever narrows it — a domain-blocked action can
      never be widened into an automatic one by anything in this layer.
      Automation level itself still only controls *who* approves, exactly as
      `docs/PRINCIPLES.md` §5 requires; every domain engine (redundancy,
      publication, fulfilment submission, refunds, the new price/inventory
      modules below) keeps deciding *whether* on its own.
- [x] A typed action vocabulary and fact-first record (`automation_actions`,
      migration `0019`): sixteen action types (`update_inventory` through
      `alert_owner`), each recorded with its input facts, decision, policy
      result, automation level, risk level and execution outcome — composing
      rather than duplicating every existing engine's own reasoning.
- [x] An application-level job queue (`automation_jobs` + `automation/jobs.ts`
      + `automation/worker.ts` + `POST /api/automation/run`): scheduled,
      delayed, retryable (exponential backoff, capped at one hour) and
      dead-lettered jobs, claimed via an atomic `UPDATE ... WHERE status =
      'pending'` rather than a locking `SELECT` (the Supabase/PostgREST
      client this project uses cannot issue `FOR UPDATE SKIP LOCKED`
      directly). The route is a plain HTTP endpoint authenticated by
      `AUTOMATION_CRON_SECRET` — any external scheduler can call it on a
      timer, and nothing about running it depends on Claude Code, ChatGPT,
      or any coding assistant staying open.
- [x] Automatic supplier switching (`automation/supplierSwitching.ts`): wraps
      Milestone 3's `evaluateSupplierRedundancy` exactly as it stands, adding
      only the kill switch and a configurable maximum cost-increase
      percentage on top.
- [x] Guarded price automation (`automation/priceAutomation.ts`, genuinely
      new this milestone): calls `calculateProfitability` directly with both
      the current and proposed price — there is no second margin formula.
      `manual`/`assisted` only ever recommend; `supervised`/`autonomous` may
      apply a change once it clears the minimum margin, the per-action
      percentage limit, and the daily movement limit.
- [x] Automatic inventory management (`automation/inventoryAutomation.ts`):
      warns on low stock, recommends a supplier switch when a compliant
      alternative exists, and proposes pausing (never deleting) when it does
      not — composing `inventory/reservation.ts`'s existing race-condition
      handling rather than reimplementing stock arithmetic.
- [x] Automated product monitoring (`automation/monitoring.ts`): the
      channel-independent half of the brief's fourteen-step checklist
      (supplier/stock health, profitability); channel-specific compliance
      and publication eligibility stay in `publicationAutomation.ts`,
      evaluated separately per channel, per `docs/PRINCIPLES.md` §3.
      An unprofitable product is flagged for a price or supplier review, not
      paused or deleted automatically.
- [x] Product publication and order automation
      (`automation/publicationAutomation.ts`, `automation/orderAutomation.ts`):
      thin wrappers around Milestone 4's `assessPublicationReadiness` and
      Milestone 5's `runOrderPipeline`, adding only the kill switch and (for
      orders) the daily automatic supplier-spend limit.
- [x] Refund automation (`automation/refundAutomation.ts`): wraps Milestone
      5's `planRefund`, adding a daily automatic-refund total and a
      per-order refund count limit — the two things a single-refund-at-a-time
      function cannot know on its own.
- [x] Emergency stop and category-level pauses (`automation/killSwitch.ts`,
      new `business_settings` columns): a global pause and six independently
      pausable categories (publishing, pricing, supplier switching, supplier
      ordering, refunds, fulfilment). A pause blocks new automatic
      *execution* only — existing monitoring, alerts and the approval queue
      keep working, per the brief's §14.
- [x] The formal approval action pipeline (`automation/approvalWorkflow.ts`,
      wired into `/approvals` for the first time since Milestone 5 left it
      read-only): approving replays the *exact* action captured in
      `ai_decisions.action_payload` at proposal time, never a recalculated
      one; if the facts the decision was proposed on have since changed
      (`factsHaveMaterializedChanged`), the approval is invalidated rather
      than executed against stale data.
- [x] New `/automation` page: kill switch, category controls, today's
      stats, risk counters, recent activity and pending jobs in live mode;
      the seven demo scenarios from the brief's §25 in demo mode, each
      isolating exactly one behaviour (verified individually — building them
      surfaced the same kind of scenario-construction bug Milestone 5's demo
      order data had, fixed the same way: bespoke, hand-controlled fixtures
      per scenario rather than forcing one shared fixture to fit every
      story).
- [x] Migrations `0019_automation_engine.sql`, `0020_rls_automation_engine.sql`:
      `automation_actions`, `automation_jobs`, plus the kill switch and new
      financial-limit columns on `business_settings`, and `risk_level`/
      `action_payload` on `ai_decisions`. 65 tables, 20 migrations. Both new
      tables are read-only through RLS, written only by the service role —
      the same model as `ai_decisions` and `automation_runs` since 0009.

**Verified:** 492 unit/integration tests pass (up from 424, +68); 20
migrations apply cleanly against PGlite; typecheck, lint and build are clean;
every route returns 200 in demo mode with no console errors; all seven demo
automation scenarios were confirmed rendering live in the browser with their
intended, isolated outcome; `POST /api/automation/run` was confirmed live,
correctly refusing to run in demo mode ("no database and no job queue to
process") rather than pretending to; `/orders`, `/marketplaces` and
`/approvals` continue to render with no regression, and Approvals now
explains demo mode's read-only limitation instead of the Milestone 5
placeholder text.

**Not implemented / explicitly out of scope for this milestone:**
- No job handler is registered yet in `automation/worker.ts`. The job queue
  and worker mechanics are real and tested (claim, execute, retry with
  backoff, dead-letter); every business decision function they would call
  (`priceAutomation`, `inventoryAutomation`, `supplierSwitching`,
  `publicationAutomation`, `orderAutomation`, `monitoring`) is itself real
  and fully tested — but assembling the *live* inputs a nightly sweep needs
  (every real product, supplier and channel row from the database, correctly
  shaped into `CostInputs`/`ComplianceContext`) is a data-plumbing task this
  milestone left honestly undone rather than faked. An unregistered job type
  fails immediately and non-retryably with that exact reason.
- Approving a decision genuinely changes its status, is genuinely audited,
  and genuinely creates an `automation_actions` record — but that record's
  execution outcome honestly reports that no live connector or
  supplier/marketplace writer exists yet to perform the actual external
  write (switching a supplier, publishing a listing, issuing a refund),
  consistent with the same limitation Milestones 4 and 5 already documented.
- No CEO Dashboard exists yet (Milestone 11) for the brief's §20 to extend —
  `automation/repository.ts`'s `getAutomationStatus` is written so that
  dashboard can read from it directly once built, rather than growing a
  second, possibly-diverging summary.
- The live Supabase/PostgREST HTTP path itself (as opposed to the
  orchestration logic running against it) is unverified — see the
  verification pass below for exactly what that means and what it would
  take to close.

**Blocked by credentials/API access:** none specific to this milestone —
everything built here is either pure decision logic (fully tested) or a
database/queue mechanism (needs a live Supabase project to exercise, same as
every prior milestone's write path).

### Milestone 6 verification pass (rigorous re-verification, same day)

The user explicitly required proof that the automation engine is a real
subsystem — that an event can enter it, be evaluated with the real
profitability/compliance/supplier engines, pass through policy, execute,
verify, notify and audit, all without Claude Code or any coding assistant
involved — and rejected "the function exists" as sufficient evidence. This
pass built the missing proof, found two real bugs in the process, and closed
several gaps the first pass had left honestly undone but incomplete.

**What changed:**

- **`automation/store.ts`**: an `AutomationStore` interface covering every
  persistence operation the engine needs (jobs, actions, audit, notify,
  settings, approvals). `jobs.ts` and `actions.ts` were refactored to return
  its plain `JobRecord`/`ActionRecord` shapes instead of raw Supabase rows,
  so they are drop-in `AutomationStore` implementations
  (`supabaseStore.ts`) rather than being Supabase-only. `inMemoryStore.ts`
  implements the identical interface for testing — not a mock returning
  canned responses, but a real (if simplified) implementation of the same
  semantics: idempotency-key uniqueness, atomic job claiming (proven using
  genuine async interleaving, not a lock), retry/backoff/dead-letter
  transitions, and the new runaway-automation safeguard.
- **`tests/automation-engine-e2e.test.ts`** (18 tests) drives the actual
  orchestration entry points — `enqueueJob`, `runWorkerBatch` — end to end,
  never calling a business decision function directly. It proves, against
  the real `evaluateSupplierSwitchAutomation` (profitability + compliance +
  policy): a permitted switch executes with a complete audit/notification
  trail; a profitability failure, a compliance failure, and an
  over-the-limit cost increase are each never executed; the emergency stop
  (both global and category-level) blocks an otherwise-identical action,
  reasons it, audits it, and resuming lets it execute again; two concurrent
  workers can never both execute the same job; duplicate events never
  create a second job; a retryable failure schedules backoff, a
  non-retryable one fails immediately, and exhausting attempts dead-letters;
  an unregistered job type fails safely, never silently succeeding; a
  crashed worker's claim is recovered after the lock timeout; one org's
  actions never leak into another's counts; and the runaway-automation
  safeguard blocks a sixth action for the same entity/action-type within an
  hour regardless of what the policy engine itself decided.
- **Two real bugs found and fixed by this test suite** (exactly the kind of
  thing "prove it, don't assume it" is for): the job handler was deciding
  whether to mark an action `succeeded` from its own stale copy of the
  policy's verdict rather than from `createAutomationAction`'s returned
  status — meaning the runaway-automation safeguard's `blocked` override was
  silently reverted back to `succeeded` immediately afterward. And the
  action's stored `reason` was always the domain engine's reason, even when
  the kill switch was the actual cause of a block — so a paused action's
  record didn't say it was paused. Both are fixed; `worker.ts` now branches
  on the store's authoritative `created.status`, and the reason field is
  always the policy's own (which passes the domain reason through untouched
  whenever the domain is itself the deciding factor).
- **A real job handler is registered**: `supplier_availability_check` in
  `worker.ts`, running the full brief §1 pipeline (facts loaded from the job
  payload → `evaluateSupplierRedundancy`'s profitability + compliance →
  `policyEngine.ts` → action recorded → notified). Assembling the payload
  from *live* product/supplier/channel rows remains the one honestly
  undone piece — the handler itself is real and tested.
- **The approval bridge** (`automation/proposeApproval.ts`): a
  `requires_approval` decision now actually creates an `ai_decisions` row
  with the full required shape (proposed action, reason, facts, financial
  impact, risk, automation level, expiry) — before this pass it only ever
  produced an `automation_actions` row that never appeared on `/approvals`
  at all. `approvalWorkflow.ts` also gained a fix in the same spirit as the
  worker bug above: it now only marks an approved action `executing` when
  the store's own status says so, rather than assuming its synthetic
  "approved" policy always wins.
- **Job cancellation** (`cancelJob`): a pending (not yet claimed) job can be
  cancelled, using the same atomic `UPDATE ... WHERE status = 'pending'`
  pattern as claiming, so a job a worker has already picked up cannot be
  cancelled out from under it.
- **The runaway-automation safeguard** (brief §15): a hard backstop in
  `createAutomationAction` itself, independent of any domain engine's
  verdict — at `RUNAWAY_MAX_ACTIONS_PER_WINDOW` (5) actions of the same type
  for the same entity within `RUNAWAY_WINDOW_MINUTES` (60), the next one is
  forced to `blocked` regardless of what the policy engine decided.
- **Two real wiring gaps closed**: `max_auto_purchase_minor` (a single
  automatic supplier order's ceiling) was read into settings but never
  actually checked anywhere — `orderAutomation.ts` now checks it alongside
  the daily total. Approval expiry silently changed status without an audit
  entry — `APPROVAL_EXPIRED` now fires one, completing the
  REQUESTED/APPROVED/REJECTED/EXPIRED/INVALIDATED/EXECUTED trail brief §11
  asked for.
- **`/automation/[id]`**: a minimal action-detail page (brief §14),
  rendering only fields actually present on the `automation_actions` row —
  what happened, why (the policy's own requirements), the facts used, the
  domain decision, and the result. No fabricated explanation text.
- **Constant-time secret comparison** on `/api/automation/run` (`timingSafeEqual`),
  closing a minor timing side-channel on the shared secret.
- 39 new tests across `automation-engine-e2e.test.ts` (18),
  `automation-level-ladder.test.ts` (4, demonstrating manual/assisted/
  supervised/autonomous side by side for the same decision), and additions
  to `automation-order.test.ts` (the new single-order limit) — 516 total, up
  from 492.

**What this proves, precisely, and what it does not:**

The orchestration logic — event → job → worker → facts → profitability →
compliance → policy → action → verification → audit → notification — is
proven correct by running the real code (`enqueueJob`, `runWorkerBatch`,
the real business modules) against a swapped persistence layer. This is the
standard way to test code that would otherwise require a live external
service, and it is not "calling the final function from a test": the test
only calls the same two functions a production HTTP request would call.
What it does **not** prove is the Supabase/PostgREST HTTP path itself — the
`@supabase/supabase-js` client has no way to run against an in-process
Postgres instance (PGlite, already used for schema verification, speaks the
Postgres wire protocol but not PostgREST's HTTP API), so exercising that
specific path for real needs a deployed Supabase project. This is the one
piece genuinely requiring production infrastructure — documented in full in
`HANDOVER.md` §19.

**No fake connected/completed/executed states were introduced.** Verified
live: the automation dashboard, kill switch, category controls, approvals
(now with working approve/reject), automation history, the new action-detail
page and the automation API route were all checked live in the browser with
no console errors beyond a stale cached message from a since-closed tab
(confirmed unrelated by opening a fresh tab and re-checking — documented as
a browser-tooling artifact, not an application bug).

**Verified:** 516 tests (up from 492, +24); 20 migrations; typecheck, lint
and build all clean; every route returns 200 with no regression;
`informax-site` confirmed untouched throughout.

## Milestone 7 — Production automation & real execution

Connects Milestone 6's automation engine to real execution without
rewriting it: a job-handler registry covering all fourteen named job types,
a live data-assembly layer (`FactsLoader`) with explicit fact freshness,
marketplace write capabilities (price/inventory/status) added to the
existing connector interface with a SUBMIT → VERIFY → RECONCILE pipeline,
and the approval bridge wired to genuinely re-check facts before executing.
No profitability, compliance, supplier-redundancy, order-orchestration,
automation-policy or audit logic was duplicated — every new module composes
an existing engine.

**What was built:**

- **`automation/store.ts` extended**: `ChannelProductReconciliation` (the
  RECONCILE step, writing a verified external change to our own
  `channel_products` row — never speculatively), `VerificationStatus`
  (`not_applicable | pending | verified | failed | uncertain`) and
  `ReconciliationStatus` (`not_applicable | matched | discrepancy | pending`)
  on `CompleteActionOutcome`/`ActionRecord`, `cancelJob`, and
  `proposeApproval`'s counterpart is now genuinely reachable from a job
  handler, not just `approvalWorkflow.ts`.
- **Migration `0021_external_action_verification.sql`**: adds
  `external_ref`, `verification_status`, `reconciliation_status` to
  `automation_actions` — deliberately *not* a new parallel table or a wider
  status enum, per the brief's "do not create redundant state systems." A
  successful submission (`status: 'executing'`) and a verified result
  (`status: 'succeeded'` with `verification_status: 'verified'`) are now
  distinguishable in the one existing record.
- **The live data-assembly layer** (`automation/factsTypes.ts` +
  `automation/facts.ts` + `automation/inMemoryFactsLoader.ts`): a
  `FactsLoader` interface — `loadProductFacts`, `loadSupplierFactsForProduct`,
  `loadChannelProductFacts` — satisfied twice exactly like Milestone 6's
  `AutomationStore`: `facts.ts` queries `products`/`suppliers`/
  `supplier_products`/`channel_products` for real; `inMemoryFactsLoader.ts`
  is a real (not mocked) test double sharing the identical freshness
  calculation (`factFrom`). Every fact is `FRESH | STALE | UNKNOWN |
  UNAVAILABLE`, computed from the record's own timestamp against a
  documented per-kind window (`FRESHNESS_WINDOW_HOURS`) — `PRODUCT_PROFITABILITY_RECHECK`
  blocks outright, with a fact-first reason, rather than recalculating
  profitability on stale or missing supplier cost data.
- **Marketplace connector write capabilities** (`marketplaces/connectors/types.ts`):
  `updateListingPrice`, `updateInventory`, `setListingStatus`,
  `verifyListingState`, a new `verifyWrites` capability flag, and a closed
  `WriteFailureReason` (`not_supported | not_configured | requires_approval |
  rejected`) so "this marketplace can't do this," "we haven't configured
  writes," and "the provider rejected this attempt" are never collapsed
  into one generic failure. Implemented for real in both demo connectors
  (genuinely stateful — a write followed by `verifyListingState` reads back
  the value just written) and partially in the live connectors: Shopify's
  price and status writes are implemented against the real REST Admin API
  (IMPLEMENTED BUT NOT LIVE-VERIFIED, same standing caveat as every other
  live connector method since Milestone 4); Shopify inventory and every
  Amazon write honestly return `not_supported` — both genuinely require API
  surfaces (Inventory Levels API; Listings Items API with a seller id this
  codebase does not yet read from the environment) that would otherwise
  need to be guessed at with no account to validate against.
- **`automation/priceExecution.ts`**: the safe price-action pipeline (brief
  §6) — FACT CHANGE → `assessPriceChange` (Milestone 6, unchanged) →
  POLICY → APPROVAL IF REQUIRED → SUBMIT (`connector.updateListingPrice`) →
  VERIFY (`connector.verifyListingState`, only reconciling on an actual
  match — never on the write call's own "accepted" response) → RECONCILE
  (`store.reconcileChannelProduct`) → AUDIT → NOTIFICATION. Proven end to
  end in `tests/automation-execution-e2e.test.ts` against the real demo
  Shopify connector: permitted-and-verified, requires-approval (never
  touches the connector), blocked-by-margin (never touches the connector),
  marketplace-rejects-the-write (never marked succeeded), and duplicate
  submission (idempotency key) never submits twice.
- **`automation/supplierSwitchExecution.ts`**: completes the redundancy flow
  (brief §4) — `evaluateSupplierSwitchAutomation` (Milestone 6, unchanged)
  → policy → approval if required → execute. "Executing" a supplier switch
  is honestly an internal write (`channel_products.fulfilment_supplier_id`)
  rather than a fabricated external call — there is no "switch my supplier"
  marketplace API; the real-world effect is which supplier the next
  purchase order goes to, which our own database entirely governs. Proven
  end to end alongside the price pipeline: a permitted switch genuinely
  updates the record; one blocked by compliance never touches it.
- **The job-handler registry** (`automation/handlers/*.ts`, `automation/worker.ts`):
  all fourteen types named in the brief — `supplier_availability_check`
  (Milestone 6, unchanged), `supplier_price_change`, `supplier_stock_change`,
  `supplier_switch`, `product_profitability_recheck`,
  `product_compliance_recheck`, `channel_eligibility_recheck`,
  `product_pause`, `product_price_review`, `marketplace_listing_sync`,
  `order_processing`, `fulfilment_update`, `tracking_check`,
  `marketplace_reconciliation`. `runWorkerBatch` now takes a `FactsLoader`
  and a `ConnectorLookup` alongside the `AutomationStore`, injected the same
  way in production (`facts.ts`, `getMarketplaceConnector`) and in tests
  (`inMemoryFactsLoader.ts`, a small connector map). Every handler is proven
  in `tests/automation-job-handlers.test.ts` (one test per type, driven
  through `runWorkerBatch`, never by calling a handler function directly),
  including two genuine event-chains (`supplier_price_change` ->
  `product_profitability_recheck` -> `product_price_review`;
  `supplier_stock_change` -> `product_pause`) and the approval-required path
  at a lower automation level.
- **Approval execution reconnected** (brief §13): `approvalWorkflow.ts`
  already re-checked expiry and stale facts (Milestone 6); this pass fixed
  a real gap found by its own reasoning — `createAutomationAction`'s
  runaway-safeguard can still force `blocked` even when the caller's
  synthetic policy says `allow_automatic`, and `approveDecision` was
  calling `completeAutomationAction` unconditionally rather than checking
  which status actually won. Fixed identically to the same bug class found
  in `worker.ts` below.
- **Two real bugs found by the new test suite** (not by inspection): (1)
  `handleSupplierAvailabilityCheck`/`approveDecision` were both deciding
  whether to mark an action `succeeded` from their own copy of the policy
  verdict rather than `createAutomationAction`'s returned `status` — so the
  runaway-automation safeguard's `blocked` override was silently reverted a
  line later. Both now branch on the store's authoritative status. (2) a
  price/switch action's `reason` was always the domain engine's reason,
  even when the kill switch was the actual cause of a block. Both fixed in
  the Milestone 6 verification pass and carried forward correctly here.
- **CEO/production-readiness view** (`automation/repository.ts`,
  `/automation` page): a new `productionReadiness` section — whether
  `AUTOMATION_CRON_SECRET` is actually configured (never inferred), live job
  counts by status, and every registered marketplace connector's real
  status (`connected | demo | not_configured | degraded | error`), reusing
  `marketplaces/connectors/registry.ts`'s existing `marketplaceConnectorSummary`
  rather than a second health check.
- **`/automation/[id]`**: unchanged from Milestone 6's action-detail page,
  now additionally shows `external_ref`/verification/reconciliation status
  where present, still reading only what the row actually stores.
- **Constant-time secret comparison** on `/api/automation/run`: already
  landed in the Milestone 6 verification pass, unchanged here.
- 23 new tests: `tests/automation-execution-e2e.test.ts` (7),
  `tests/automation-job-handlers.test.ts` (16) — 539 total, up from 516.

**IMPLEMENTED AND VERIFIED** (by tests driving real entry points, never a
decision function directly):
- The full acceptance-test loop (fact change → job → worker → facts loaded
  → profitability/compliance re-checked → supplier alternatives evaluated
  where relevant → policy applied → approval requested OR executed →
  external connector call → verification → reconciliation → audit →
  notification) for the two flagship pipelines (price change, supplier
  switch) and, at a wiring-confidence level with one dedicated test each,
  for the other twelve job handlers.
- Idempotency: a retried price-change or supplier-switch event never
  submits, executes, or notifies twice (`idempotencyKey` on both the job
  and the resulting action).
- Channel independence: `channel_eligibility_recheck` evaluates exactly one
  channel per call by construction; nothing here can collapse two channels'
  verdicts into one.
- Kill switch, category pauses, money limits, organisation isolation: all
  re-verified against the new execution paths (a paused category blocks a
  price/switch execution exactly as it blocked a check in Milestone 6).

**IMPLEMENTED BUT NOT LIVE-VERIFIED:**
- Shopify's real `updateListingPrice`/`setListingStatus` — written against
  the published REST Admin API, never run against a real store.
- Everything else Milestone 4/5/6 already carried this label for continues
  to carry it; nothing here changes that standing caveat.

**REQUIRES PRODUCTION INFRASTRUCTURE** (the honest answer to "does this run
24/7 without Claude Code," carried forward and extended from Milestone 6):
- A deployed Supabase project — the `AutomationStore`/`FactsLoader`
  orchestration logic is proven correct against real implementations of
  both interfaces; the actual `@supabase/supabase-js` → PostgREST HTTP path
  is not exercised by any test here, for the same reason Milestone 6
  documented (no way to run a real PostgREST server against an in-process
  database in this environment).
- An external scheduler calling `POST /api/automation/run` on an interval —
  still nothing in this repository calls it periodically.
- The live data-assembly layer is real for products/suppliers/channel
  products but still requires a caller (a future live event source: a
  webhook, a scheduled sweep job) to actually enumerate real entities and
  enqueue jobs for them — `FactsLoader` answers "what is true for this one
  entity," not "which entities need checking today."
- Amazon's Listings Items API write path needs a seller id
  (`AMAZON_SP_SELLER_ID`, not currently read) and a product-type-specific
  JSON Patch schema this codebase has never validated against a real
  account.

**NOT IMPLEMENTED:**
- Shopify inventory writes (needs the Inventory Levels API's
  `inventory_item_id`/`location_id`, not yet resolved by this connector's
  read side).
- Every Amazon write capability (price, inventory, status) — all honestly
  `not_supported` rather than guessed at.
- A live event source that detects a real supplier price/stock change and
  enqueues `supplier_price_change`/`supplier_stock_change` jobs — those
  handlers exist and are tested, but nothing in the live application calls
  `enqueueJob` for them yet.

**BLOCKED BY CREDENTIALS:** live-verifying any Shopify or Amazon write
requires the same real store/seller account named as blocked in every
marketplace milestone since Milestone 4.

**Final acceptance test, demonstrated in demo mode without Claude Code**
(brief §21): `tests/automation-execution-e2e.test.ts`'s first test enqueues
a price-change event, runs it through `runWorkerBatch` against the real
demo Shopify connector, and asserts — in one continuous run — that the
policy was applied, the connector was called, `verifyListingState` confirms
the marketplace's own reported price now matches, `channelProductReconciliations`
reflects the reconciled value, the action's audit trail contains creation
and execution entries, and a success notification was created. This is the
exact chain the brief specifies, driven through `enqueueJob`/`runWorkerBatch`
— never by calling `assessPriceChange` or the connector directly from the
test.

**Verified:** 539 tests (up from 516, +23); 21 migrations; typecheck, lint and build all clean; every
route (`/automation`, `/automation/[id]`, `/approvals`, `/suppliers`,
`/products`, `/marketplaces`, `/orders`, `/api/automation/run`) confirmed
live with no console errors beyond a stale cached message from a
since-closed tab (confirmed unrelated by opening a fresh tab); `informax-site`
confirmed untouched throughout.

## Milestone 8 — Continuous intelligence, monitoring & event generation ✅ complete

Milestone 7 answers "what is true about product X right now?" This milestone
answers "what should the system check right now, what changed, and does that
change require action?" It sits strictly upstream of the Milestone 6/7
automation engine — monitors observe and raise domain events; they never
decide or act. The full chain: schedule/event source → monitoring → load
current facts → compare with previous verified facts → detect meaningful
change → create domain event → deduplicate/coalesce → create automation job
→ the existing automation engine → submit → verify → reconcile → audit →
notification.

**What was built:**

- **Schema** (`0022_monitoring_events.sql`, `0023_rls_monitoring_events.sql`):
  `domain_events` (id, org_id, event_type, subject_type, subject_id, source
  `local|external|internal`, source_connector_key, source_observation_id,
  occurred_at, detected_at, severity, previous_value/current_value jsonb,
  facts/metadata jsonb, dedupe_key, correlation_id, causation_id self-FK,
  status, automation_job_id FK, superseded_by self-FK, monitor_run_id,
  is_demo) with a partial unique index
  `(org_id, dedupe_key) WHERE status = 'open' AND dedupe_key IS NOT NULL` —
  the actual deduplication guarantee, not an application-level convention;
  `monitor_observations` (composite PK org_id+monitor_key+subject_type+
  subject_id, status `ok|unavailable|unknown`, value jsonb,
  last_checked_at) — each monitor's own "what did I last see" cursor;
  `monitor_runs` (org_id, monitor_key, status, started_at, completed_at,
  subjects_checked, observations_created, events_created,
  events_deduplicated, error, next_scheduled_at, locked_by, locked_at,
  correlation_id). All three read-only under RLS (service role writes only),
  same pattern as `automation_actions`/`automation_jobs`. 68 tables, 23
  migrations.
- **`EventStore`** (`monitoring/eventTypes.ts`, `eventStore.ts`,
  `inMemoryEventStore.ts`): the same "define the interface, satisfy it
  twice" pattern as `AutomationStore`/`FactsLoader`. `createEvent` is
  idempotent on `dedupeKey` — a duplicate insert is detected via Postgres
  error `23505` in the real store and re-queries the existing open event;
  the in-memory store reproduces the same race with two genuine
  `await Promise.resolve()` yields between its check and its commit, proven
  safe under real `Promise.all` interleaving in
  `tests/monitoring-concurrency.test.ts` (2-way, 10-way, and monitor-level
  races). Schedule intervals and numeric thresholds are read from the
  existing `config_values` table (Milestone 1) — no new configuration
  table.
- **Five monitors** (`monitoring/monitors/*.ts`), one per required category,
  each composing an existing engine rather than duplicating it:
  - `supplierMonitor.ts` — stock and price, per supplier/product pair.
    Distinguishes a genuine "unavailable" observation (`SUPPLIER_FEED_FAILED`)
    from a genuine "in stock: false" observation (`SUPPLIER_OUT_OF_STOCK`) —
    a failed connector can never be silently read as "out of stock." Price
    changes compared against a configurable threshold (default 3%), not a
    hardcoded one.
  - `marketplaceMonitor.ts` — fetches real external listings from a
    connector and calls `reconcileListings` (Milestone 4, unmodified) to
    find genuine divergence. Loop prevention: it compares the marketplace's
    live state against *our own already-reconciled local record* — a price
    change our own automation just wrote and verified no longer looks like
    external drift, which is what stops the reprice-loop the brief warned
    about, proven in `tests/monitoring-marketplace.test.ts`'s "loop
    prevention" test.
  - `complianceMonitor.ts` — calls `decideComplianceRecheck` (Milestone 5)
    directly; no compliance rule is re-implemented here.
  - `profitabilityMonitor.ts` — a pure boundary check on supplier cost
    (has it moved since the last look?), never a margin calculation; the
    real margin arithmetic runs once the chained `product_profitability_recheck`
    job calls `calculateProfitability` (the one profitability engine).
  - `performanceMonitor.ts` — sales surge/decline, return-rate increase, ad
    spend vs limit. Honest scope boundary: there is still no live
    sales-aggregation query in this codebase, so the comparison windows are
    caller-supplied, not queried from `orders`/`order_items` — the
    comparison logic itself is real and tested. Never invents a "trending"
    label without storing the calculation basis (units and date ranges) in
    the event's `facts`.
- **`registry.ts`**: a closed `MONITORS` map (mirrors `worker.ts`'s
  `HANDLERS` map) and an explicit, auditable `EVENT_TO_JOB_MAPPING` table —
  every event type this milestone defines maps to either a real job type or
  `null` ("no safe automated action exists yet — event and notification
  only"), never a guess buried in a conditional.
  `tests/monitoring-registry.test.ts` drives real monitor scenarios and
  asserts the job actually enqueued (by `correlationId === event.id`)
  agrees with the declared mapping, and separately asserts every non-null
  mapped job type is a real, registered handler in `worker.ts`.
- **`runner.ts`** (`runDueMonitors`): the scheduler integration. Reuses
  `automation/jobs.ts`'s concurrency philosophy rather than inventing a
  second one — a monitor "claim" is simply inserting a `monitor_runs` row;
  safety comes from every downstream write (`createEvent`) being itself
  idempotent, so a duplicate tick produces duplicate *attempts* but never
  duplicate *events*. Subject enumeration is wrapped in the same `try` as
  the monitor run itself — **a real bug found by this milestone's own
  tests**: the first draft called the caller-supplied `subjectsFor` before
  starting the run record, so a failure enumerating subjects (e.g. a
  database outage) would crash the entire scheduler sweep for every org and
  monitor, with no `monitor_runs` row at all to show it happened. Fixed by
  moving `startMonitorRun` before subject enumeration and wrapping both in
  the same `try`/`catch`, so a subject-enumeration failure is now correctly
  recorded as a `failed` run like any other. Run status is `success` when
  no subject errored, `partial_success` when some but not all did, `failed`
  when all did — never reported as success when half the connectors
  failed.
- **`POST /api/monitoring/run`**: same constant-time-secret pattern as
  `/api/automation/run` (both now share `core/schedulerAuth.ts`), iterates
  every organisation and calls `runDueMonitors` with the real Supabase-backed
  `EventStore`/`AutomationStore`/`FactsLoader`. Demo mode returns
  `{status: "skipped", reason: "Demo mode has no database and no monitors to
  run."}` rather than fabricating a run.
- **`liveSubjects.ts`**: real Supabase queries enumerating subjects for
  `supplier_stock_and_price` (via `supplier_products`/`channel_products`)
  and `marketplace_listing_sync` (via `channel_products` where
  `status = 'live'`, hardcoded to the `shopify` connector for now); the
  other three monitors return `[]` — an honestly documented following-pass
  gap, not a hidden stub. `FactsLoader`'s Milestone 7 boundary ("answers
  what's true for X, not which X to check") applies identically here.
- **Two further real bugs found by the flagship integration test**
  (`tests/monitoring-integration-e2e.test.ts`, which chains
  `runDueMonitors` into `runWorkerBatch` against the same shared in-memory
  stores — the brief's explicit "do not test only individual functions"
  requirement): (1) `handleSupplierPriceChange` (Milestone 7) enqueued its
  chained `product_profitability_recheck` job without a `channelProductId`
  — a field that handler's own payload validator requires — so **every
  supplier-price-change chain in production has always failed** as
  "malformed payload" the moment the chained job was actually claimed. This
  was invisible to Milestone 7's own handler test because that test only
  asserted the chained job's existence, never actually ran it. Fixed by
  adding `channelProductId` to `SupplierPriceChangeJobPayload`, its
  validator, and both call sites (`supplierMonitor.ts` and the existing
  `automation-job-handlers.test.ts`, which now also runs the chained job
  and asserts it succeeds, not just that it exists). (2) `profitabilityMonitor`
  raised an event on the very first-ever observation of a product (no prior
  baseline existed, so "undefined cost" was compared as "different from"
  the current cost) — fixed to silently establish a baseline on first
  observation, matching `supplierMonitor`'s existing pattern. (3)
  `performanceMonitor`'s own `PRODUCT_SALES_DECLINING` event was not
  actually enqueuing the `product_profitability_recheck` job its own
  `EVENT_TO_JOB_MAPPING` entry declared — found by
  `tests/monitoring-registry.test.ts`'s consistency check, fixed to match.
- **Business intelligence / live operations** (`monitoring/repository.ts`,
  `/automation` page): there is still no dedicated CEO Dashboard (that
  remains Milestone 11) — this extends the same `/automation` page
  Milestone 7's production-readiness view already established. Shows
  monitors registered/run-in-24h/failed-in-24h/never-run, open
  critical/warning events, unavailable-supplier/reconciliation/compliance
  alert counts, and a recent-events feed — all read from real
  `monitor_runs`/`domain_events` rows, never inferred. Demo mode instead
  runs the 5 required scenarios live (`demo/monitoring.ts`) against
  in-memory stores and renders their actual output.
- **Demo scenarios** (`demo/monitoring.ts`): all 5 required cases, each
  driven through the real monitor + worker entry points, not narrated —
  supplier price increase (£9.10 → £10.76) chaining into a real
  profitability recheck; supplier out-of-stock chaining into the existing
  redundancy evaluator; a genuine marketplace mismatch producing an
  auditable `LISTING_OUT_OF_SYNC`/price-changed event; a failed supplier
  connector producing `SUPPLIER_FEED_FAILED` with zero jobs enqueued: an
  unknown fact never triggers a guess; and the same out-of-stock condition
  checked 4 times in a row producing exactly one event and one job.

**IMPLEMENTED AND VERIFIED** (by tests driving real entry points — monitors,
`runDueMonitors`, `runWorkerBatch` — never a decision function directly):

- Fact-first observation distinctions: `unavailable` vs `unknown` vs `ok`
  never conflated; a failed connector never becomes an inferred stock state.
- Meaningful-change detection against configurable thresholds (never a
  hardcoded percentage).
- Event deduplication under real concurrency (2-way, 10-way, and
  monitor-level `Promise.all` races) and under repeated sequential runs.
- Loop prevention in the marketplace monitor (comparing against our own
  already-reconciled state, not naively re-diffing on every tick).
- The full chain monitor → event → job → worker → live facts → the
  profitability engine → an automation action with a real policy outcome →
  audit → (conditionally) notification, through real entry points only.
- Unknown/unavailable data cannot trigger an automated action (proven, not
  asserted, in the flagship integration test).
- `EVENT_TO_JOB_MAPPING` consistency with what monitors actually enqueue.
- Org isolation on every new table (RLS asserted via `db:verify`, and
  `tests/monitoring-events.test.ts`/`tests/monitoring-scheduler.test.ts`
  exercise cross-org independence at the application layer too).
- 57 new tests (596 total, up from 539): `monitoring-events.test.ts` (event
  lifecycle/dedup/org isolation, 9 tests including `isMonitorDue`),
  `monitoring-supplier.test.ts` (9), `monitoring-marketplace.test.ts` (5),
  `monitoring-concurrency.test.ts` (3), `monitoring-compliance-profitability-performance.test.ts`
  (13), `monitoring-scheduler.test.ts` (8), `monitoring-registry.test.ts`
  (6), `monitoring-integration-e2e.test.ts` (2, the flagship chain), plus
  one strengthened assertion in the existing `automation-job-handlers.test.ts`
  (not counted as new). Typecheck, lint and `npm run build` all clean; `/automation` and
  `/api/monitoring/run` confirmed live in the browser with no console
  errors; `informax-site` confirmed untouched throughout (git status
  checked before and after).

**IMPLEMENTED BUT NOT LIVE-VERIFIED:**

- Every Supabase-backed path (`eventStore.ts`, `liveSubjects.ts`, the live
  branch of `/api/monitoring/run`) — proven against the identical
  `EventStore`/`AutomationStore`/`FactsLoader` interfaces production code
  uses, but never against a real deployed Postgres/PostgREST instance,
  because none exists in this environment. Same standing caveat as every
  live Supabase path since Milestone 1.
- The partial unique dedupe index's real-Postgres behaviour under genuine
  concurrent connections (the in-memory store's interleaving proof is a
  faithful reproduction of the same semantics, not a substitute for it).

**REQUIRES PRODUCTION INFRASTRUCTURE:**

- An actual external scheduler calling `POST /api/monitoring/run` on an
  interval — nothing in this codebase calls it on its own, by design (same
  as `/api/automation/run` since Milestone 7).
- Real Shopify/Amazon credentials, to find out whether `liveSubjects.ts`'s
  live queries and the marketplace monitor's live connector calls behave as
  expected against a real store/account.

**EXPLICITLY NOT IMPLEMENTED at the time this section was first written** (a
real, documented gap, not a hidden stub) — **resolved by the Milestone 8.5
completion pass below except where noted**:

- ~~`liveSubjects.ts` returns `[]` for `marketplace_listing_sync` beyond the
  single hardcoded `shopify` connector, and for
  `profitability_safety_net`/`compliance_freshness`/`sales_performance`
  entirely~~ — **resolved**: all 6 registered monitors now have real,
  paginated, org-scoped discovery, and marketplace discovery reads each
  listing's actual channel key rather than assuming Shopify.
- ~~No live sales/order aggregation query feeds `performanceMonitor`~~ —
  **resolved**: `orders/salesAggregation.ts` aggregates real
  `orders`/`order_items`/`refunds` rows; Milestone 10 (analytics and
  business intelligence) should extend this module rather than build a
  second one.
- ~~Supplier delivery/dispatch/cancellation-rate/connector-health
  monitoring... is not built~~ — **resolved** for dispatch, delivery,
  cancellation rate, fulfilment reliability and feed staleness (a new
  `supplierOperationsMonitor`); still not built: supplier feed health
  differentiated per-connector-type beyond `supplier_connectors`' own
  status field (a finer distinction than this pass needed).
- No dedicated CEO Dashboard route — **still not built**; the
  business-intelligence section (now including supplier/product/marketplace
  intelligence drill-downs) extends `/automation` per this milestone's
  brief; Milestone 11 remains the dedicated dashboard.

**Verified:** 596 tests (up from 539, +57); 23 migrations (68 tables);
typecheck, lint and `npm run build` all clean;
`/automation` and `/api/monitoring/run` confirmed live in the browser with
no console errors; `informax-site` confirmed untouched throughout.

### Milestone 8.5 — Complete live monitoring inputs & production subject discovery

A completion pass, not a new numbered milestone, finishing the three gaps
just above. Full detail in `HANDOVER.md` §22 — summary here:

- `liveSubjects.ts` rewritten with real, bounded-paginated (500 rows/page,
  20-page ceiling), org-scoped discovery for all 6 monitors.
  `runner.ts`'s `SubjectProvider` now returns `{ subjects, errors }` so a
  discovery source failing (one supplier's connector times out) yields
  `partial_success`, never a false `success` or silently lost coverage.
- `orders/salesAggregation.ts`: real sales-window aggregation (units,
  orders, gross/net revenue, average order value, sales velocity,
  refunds vs returns) from real order data. `performanceMonitor` gained
  `REVENUE_DECLINED` and `PRODUCT_UNDERPERFORMING`/`PRODUCT_SALES_RECOVERED`.
- New `supplierOperationsMonitor` (6th registered monitor,
  `supplier_operations`): dispatch time, observed delivery days,
  cancellation rate, fulfilment reliability and feed staleness, from real
  `supplier_products`/`supplier_connectors`/`shipments` data, via a new
  `FactsLoader.loadSupplierOperationalFacts` method.
- `/automation`'s business-intelligence section extended with
  `monitorsDegraded`/`monitorsOverdue` and supplier/product/marketplace
  intelligence drill-downs (real open-event subject ids, never bare
  counts). A 6th demo scenario added.
- **A real, systemic bug found by deliberately probing "supplier price
  oscillation"**: several monitors' dedupe keys encoded only the
  *direction* of a change, not its resulting value — since nothing
  auto-resolves a price/cost/sales-surge event, a **second genuine change
  in the same direction silently vanished**, deduplicating against the
  first still-open event forever. Fixed across `supplierMonitor`,
  `profitabilityMonitor`, `performanceMonitor`, and `marketplaceMonitor` by
  keying on the actual observed value; 4 regression tests added.

**Verified:** 626 tests (up from 596, +30); no new migrations (68 tables,
23 migrations, unchanged); typecheck, lint and `npm run build` all clean;
`/automation`, `/api/monitoring/run`, `/suppliers`, `/marketplaces`,
`/orders`, `/approvals` confirmed live with no console errors;
`informax-site` confirmed untouched.

**Still not implemented**: a genuine SQL "is this row actually due"
predicate for compliance/profitability/sales-performance discovery (every
eligible row is enumerated per page instead); `scoreSupplier`'s weighted
total does not yet incorporate the new operational facts (deliberate — see
`HANDOVER.md` §22); `SALES_VELOCITY_CHANGED` was not built as a separate
event (judged redundant with `PRODUCT_UNDERPERFORMING` plus the existing
surge/decline events).

## Milestone 9 — Global market intelligence & international expansion ✅ complete

Every milestone through 8.5 answered "is this product right for the UK,
sold on Shopify or Amazon UK?" This milestone asks the same questions
across countries, currencies and marketplaces, without ever pretending a
compliance pass, a profitability number, or an exchange rate is known when
it isn't. Six non-negotiable principles carried through the whole build:
no universal "product is compliant" boolean (every result is scoped to
product + marketplace + country + assessment version + time); no silent
cross-currency arithmetic; exchange rates are versioned facts with
provenance and freshness, never invented; one profitability engine, reused
via an explicit FX-normalisation step, never duplicated; compliance is
assessed before automation ever considers acting, and unknown compliance
never silently becomes compliant; country rulesets are versioned and
attributable, never a hardcoded global legal database.

- **`src/lib/fx/`**: `types.ts` (`ExchangeRateFact`, `fresh`/`stale`/
  `unknown`/`unavailable` freshness states, per-use-case staleness windows —
  6h for automation, 24h for product evaluation and order fulfilment, 7
  days for strategic expansion), `convert.ts` (`convertMoney` returns a
  `Result`, rejects same-currency no-ops and mismatched-pair rates as
  explicit errors), `inMemoryFxStore.ts` / `fxStore.ts` (the interface
  satisfied twice, `server-only` on the Supabase side), `demoRates.ts`.
- **`src/lib/markets/`**: `catalog.ts` (`MARKET_CATALOG`, a closed,
  pure-TypeScript registry of 9 country/marketplace combinations — 2 backed
  by the real Shopify/Amazon UK connectors, 7 explicitly `connectorKey:
  null` and reported as `planned`, never claimed live); `resolveMarketStatus`
  derives each market's live `LIVE`/`DEMO`/`PLANNED`/`NOT_CONFIGURED` state
  at read time from the real connector registry (`deriveMarketplaceStatus`,
  Milestone 4), so it can't drift once credentials are configured;
  `countryCompliance.ts` (`assessMarketCompliance` delegates to the real
  `assessCompliance` engine for GB and returns an honest `not_assessed` for
  every other country — no invented ruleset); `marketCostProfiles.ts`
  (seed fee/fulfilment/tax assumptions per market, each documented as a
  seed, not a live lookup); `marketProfitability.ts`
  (`resolveMarketProjectionInput` does FX normalisation *before*
  `projectMarketProfitability` calls the one existing profitability engine
  — this is what lets a real FX movement flip a market's native pass/fail,
  not just a side "comparison" figure); `expansion.ts`
  (`evaluateMarketExpansion`, a deterministic rule engine: fatal checks
  — compliance fail, supplier cannot ship, profitability fails outright —
  are checked and can block *before* the transparent, renormalised
  0–100 score is ever consulted, so a high score can never override a
  compliance failure; outcomes are `ready`/`promising`/`requires_review`/
  `blocked`/`insufficient_facts`); `supplierMarketFacts.ts` /
  `supplierMarketFactsStore.ts` (can-ship, shipping cost/currency, delivery
  window, cancellation rate, per supplier per destination country);
  `repository.ts` / `inMemoryMarketRepository.ts` /
  `supabaseMarketRepository.ts` (append-only `market_expansion_assessments`
  persistence, each row storing the exact job payload that produced it so a
  chained FX recheck can replay it verbatim).
- **New monitors**: `fxMonitor.ts` (movement/staleness/unavailability,
  registered as `fx_rates`) and `marketMonitor.ts` (profitability
  deterioration/recovery, compliance recheck required, supplier capability
  changed, market became viable, registered as `market_expansion`) — both
  added to `registry.ts`'s `MONITORS` map and `EVENT_TO_JOB_MAPPING`
  (`fx_recheck`, `market_recheck`).
- **New job handlers**: `automation/handlers/marketHandlers.ts`
  (`handleMarketRecheck` re-runs `evaluateMarketExpansion` against current
  facts and persists the assessment — only a `ready` outcome creates a
  `request_approval` action; nothing is ever auto-executed;
  `handleFxRecheck` finds every stored assessment that used the affected
  currency pair and re-enqueues a `market_recheck` for each, from its
  stored payload). `JobHandler`'s type gained an optional 5th
  `marketDeps` parameter — all 14 existing handlers stay assignable
  unchanged because TypeScript's structural typing doesn't require it.
  Monitoring → event → job → worker → existing automation policy/approval
  path is reused end to end; no parallel automation system was built.
- **UI**: `/automation`'s business-intelligence section gained a "Global
  expansion intelligence" card (FX staleness/movements, markets with
  profitability deterioration, compliance rechecks required, supplier
  capability changes, markets that became viable) and a "Market readiness"
  card (every `MARKET_CATALOG` entry's real, resolved status). The product
  detail page (`/opportunities/[id]`) gained a "Global expansion matrix"
  section rendering real `evaluateMarketExpansion` output per market
  (Market / Compliance / Profitability / Supplier / Marketplace / Score /
  Status) — no new route created, per the brief's explicit instruction not
  to build one if the existing product detail page already fits.
- **Schema**: `0024_global_markets.sql` — `exchange_rates` (append-only),
  `supplier_market_capabilities` (mutable, current-state), 
  `market_compliance_assessments` (mutable, current-state),
  `market_expansion_assessments` (append-only, `source_payload jsonb`
  column storing the triggering job payload, plus a check constraint
  keeping comparison-currency and comparison-profit columns paired).
  `0025_rls_global_markets.sql` — all four read-only through RLS to org
  members, service-role-only writes, matching every prior milestone's
  pattern. `CurrencyCode` extended from `GBP`/`EUR`/`USD` to also include
  `CAD`/`AUD`.
- **Demo data**: `demo/marketExpansion.ts` builds all 5 scenarios the brief
  required, each computed through the real engines rather than
  hardcoded — UK ready / Germany insufficient-facts / US blocked, each for
  a different genuine reason; a real FX movement flipping a market's
  compliant-and-profitable assessment to a loss through the actual
  FX→monitor→event→job→profitability-recheck chain (not faked); one market
  passing and another failing from real market-specific cost assumptions;
  excellent profitability blocked by unknown compliance; passing
  compliance and profitability blocked by a supplier that cannot ship to
  the destination country.
- **Real bugs found by deliberate probing, not by inspection** (the same
  pattern every milestone since Milestone 6 has followed):
  1. **FX rate timestamp-tie race**: `inMemoryFxStore.getLatestRate`'s
     `reduce` used a strict `>` comparison, which on an exact-timestamp tie
     silently kept the *first*-inserted rate rather than the most recently
     recorded one. The identical bug existed in the production
     `fxStore.ts` Supabase query. Fixed in both by adding a stable
     insertion-order tiebreaker (`.getTime() >=` in memory, a secondary
     `.order('id', {ascending:false})` in the live query) — the same
     failure class the M8.5 dedupe-key bug belonged to, caught before it
     shipped this time because the brief explicitly asked for FX
     oscillation probing.
  2. **React duplicate-key warning** on `/opportunities/[id]`, found via a
     live browser console check: the currency-movement demo scenario
     renders the same market twice (before/after), and the table key was
     market-key-only. Fixed with an index-qualified key plus an explicit
     "(before)"/"(after)" label.
  3. Concurrent-evaluation and partial-discovery-failure bug hunts (10-way
     `Promise.all` races against `fxMonitor` and `marketMonitor`; one
     monitor's subject discovery failing outright in the same sweep as
     another's success) found no further defects — both are covered by
     regression tests (`tests/markets-bug-hunting.test.ts`) precisely so a
     future change that reintroduces either failure mode is caught
     immediately rather than found again by hand.

**IMPLEMENTED AND VERIFIED:**

- Currency-mismatch rejection, FX-conversion provenance, and staleness
  detection (`tests/fx-convert.test.ts`).
- The deterministic expansion engine's full outcome space and its
  fatal-check-before-score ordering (`tests/markets-expansion.test.ts`).
- Country-scoped compliance divergence — a GB pass never implies anything
  about any other country, and every other country returns an honest
  `not_assessed` (also `tests/markets-expansion.test.ts`).
- The full monitoring→event→job→worker→FX-normalisation→profitability→
  expansion-assessment chain through real entry points only
  (`runDueMonitors` + `runWorkerBatch`, never business functions called
  directly) — `tests/markets-integration-e2e.test.ts`, with hand-verified
  numbers proving a real FX rate movement flips a market's native
  profitability pass/fail, not just a comparison figure.
- Concurrency safety (10-way races, both new monitors) and partial
  subject-discovery-failure isolation — `tests/markets-bug-hunting.test.ts`.
- Job-handler behaviour: `handleMarketRecheck` only ever requests approval
  on a `ready` outcome and never auto-executes; `handleFxRecheck` correctly
  re-enqueues every affected assessment from its stored payload —
  `tests/market-handlers.test.ts`.
- All 5 required demo scenarios, computed through the real engines —
  `tests/demo-market-expansion.test.ts`.
- All 5 in-scope routes (`/automation`, `/opportunities/[id]`,
  `/marketplaces`, `/orders`, `/approvals`) confirmed live in the browser
  with no console errors after the duplicate-key fix.

**IMPLEMENTED BUT NOT LIVE-VERIFIED:**

- Every Supabase-backed path (`fxStore.ts`,
  `supplierMarketFactsStore.ts`, `supabaseMarketRepository.ts`, the live
  branch of `discoverFxPairs`) — proven against the identical `FxRateStore`
  / `SupplierMarketFactsLoader` / `MarketExpansionRepository` interfaces
  production code uses, never against a real deployed Postgres instance,
  because none exists in this environment. Same standing caveat as every
  live Supabase path since Milestone 1.

**REQUIRES PRODUCTION INFRASTRUCTURE:**

- A real FX rate provider/connector — `demoRates.ts` is an explicit demo
  seed, not a live feed; the `FxRateStore` interface is provider-agnostic
  by design so a real connector can be added without touching any
  consuming code.
- Real supplier capability data per destination country — the current
  facts are seed data via `createInMemorySupplierMarketFactsLoader`'s seed
  records and the equivalent Supabase table, not a live supplier-quoted
  feed.
- Real marketplace connectors for the 7 `planned` markets in
  `MARKET_CATALOG` — building them was explicitly out of scope for this
  milestone; `resolveMarketStatus` will report `LIVE` automatically the
  moment a real connector is registered, no market-model change needed.

**NOT IMPLEMENTED (deliberately, not a hidden gap):**

- Country-specific legal/tax rulesets beyond GB — `countryCompliance.ts`
  returns an explicit, reasoned `not_assessed` for every other country
  rather than guessing; adding a second country's ruleset is future work
  requiring genuine legal research, not an architecture change.
- `market_expansion` subject discovery in `liveSubjects.ts` (live branch)
  still returns `{subjects: [], errors: []}` with a documented-gap
  comment — assembling a live `ComplianceContext` per product per market
  from real facts was judged out of scope for this pass; the demo branch
  and the flagship integration test both exercise the full chain via
  directly-constructed subjects instead.
- A market opportunity leaderboard/ranking UI beyond the per-product
  expansion matrix (the brief's Part 8 was satisfied via the existing
  product detail page, per its own explicit instruction not to build an
  unnecessary new route).

**Verified:** 687 tests (up from 626, +61); 25 migrations (72 tables, up
from 68); typecheck, lint and `npm run build` all clean; `/automation`,
`/opportunities/[id]`, `/marketplaces`, `/orders`, `/approvals` confirmed
live with no console errors; `informax-site` confirmed untouched
throughout.

## Milestone 10 — Analytics and business intelligence ✅ complete

Every milestone through 9 answered "what is true about this one product,
supplier, or market right now?" This milestone rolls those same facts up
into "how is the business actually performing?" — revenue, profit, sales
trends, product/channel/supplier/fulfilment/international performance, a
deterministic business-health alert feed, and a data-quality summary, all
fact-first: every figure is FACT, CALCULATED, DERIVED, ESTIMATE, UNKNOWN,
STALE or UNAVAILABLE, and a missing cost or a disconnected advertising
platform is never rendered as zero. No AI prediction engine was built — a
future layer can add one, clearly labelled, without touching anything here.

- **`src/lib/core/compare.ts`**: `comparePeriods(current, previous)` — the
  one place "current vs previous, absolute diff, percentage diff, direction"
  is computed, with the same divide-by-zero rule (`previous === 0` yields
  `null`, not `Infinity`, unless `current` is also `0`) every caller now
  shares. `monitoring/monitors/performanceMonitor.ts`'s previously-private
  `pctChange` helper was refactored to call this rather than keep its own
  copy.
- **`src/lib/orders/salesAggregation.ts` extended, not duplicated**: 9 named
  periods (`today`/`yesterday`/`last_7_days`/`last_30_days`/`month_to_date`/
  `previous_month`/`quarter_to_date`/`year_to_date`/`custom`) via
  `resolvePeriod`, and `previousEquivalentPeriod` — calendar-anchored
  periods (month/quarter/year-to-date) compare against the *same elapsed
  fraction* of the prior calendar period (24 August's month-to-date
  compares against 1–24 July, never the whole of July), not just an
  equal-length window, so a partial period never looks like a false decline
  against a complete one. `aggregateSalesWindow` itself is unchanged and
  reused, not reimplemented.
- **`src/lib/analytics/`** (new module, one file per concern, mirroring
  Milestone 9's `markets/`/`fx/` granularity):
  - `types.ts` — the `FactStatus` vocabulary (`fact`/`calculated`/`derived`/
    `estimate`/`unknown`/`stale`/`unavailable`) and `Metric<T>`/
    `PeriodMetric<T>` wrappers every analytics figure is returned in.
  - `salesAnalytics.ts` — wraps `aggregateSalesWindow` (called twice, once
    per period, by the live loader) into labelled, comparison-bearing
    figures; a genuine zero-sales window is `fact`, never `unknown`.
  - `profitAnalytics.ts` — per product-per-channel profitability, calling
    `profitability/channels.ts`'s `buildChannelProfiles`/`projectChannel`
    (the same engine `/opportunities/[id]` and `profitabilityMonitor.ts`
    already use) — never a second margin calculator. Rejects a supplier
    cost quoted in a different currency than the channel's listing price
    as `unavailable` rather than combining them.
  - `productAnalytics.ts` — deterministic classification
    (`top_revenue`/`top_profit`/`high_margin`/`low_margin`/`loss_making`/
    `declining_sales`/`growing_sales`/`high_refund_rate`/`supplier_risk`/
    `stock_risk`/`compliance_risk`/`channel_opportunity`) from real ranks,
    margins and open-event flags — no invented score.
  - `channelAnalytics.ts` — per-channel sales + a known-profit rollup that
    states how many products were excluded and why (unknown cost, or a
    genuine currency mismatch — see the bug below).
  - `supplierAnalytics.ts` — `HEALTHY`/`WATCH`/`AT_RISK`/`UNAVAILABLE`/
    `UNKNOWN`, from real dispatch/cancellation/fulfilment-success facts and
    open monitoring events, always with a stated reason.
  - `fulfilmentAnalytics.ts` — dispatch time, on-time delivery rate,
    cancellation rate, missing-tracking count; a shipment with no delivery
    confirmation and no tracking is `unknown`, never assumed delivered.
  - `advertisingAnalytics.ts` — the interface a future Amazon
    Ads/Meta/Google/TikTok Ads connector will satisfy; every figure is
    `unavailable` today because no such connector exists anywhere in this
    codebase, never a fabricated £0 spend.
  - `dataQuality.ts` / `businessHealth.ts` — a rollup of every other
    module's unknown/stale/unavailable counts into a CEO-legible issue
    list, and a deterministic alert feed (revenue decline, profit decline,
    profit decline *despite* revenue growth, supplier at-risk/unavailable,
    data-quality gaps) where every alert carries the real comparison or
    classification that produced it as `evidence`.
  - `liveAnalyticsFacts.ts` (`server-only`) — the one caller that turns
    org-scoped, paginated Supabase queries (via the newly-shared
    `supabase/paginate.ts`, extracted from `monitoring/liveSubjects.ts` so
    both share one bounded-pagination implementation) into the fact shapes
    above; every query is scoped by `org_id`.
  - `repository.ts` extended (the pre-existing Milestone 1 reporting reads
    `/report` uses are untouched) — `getAnalyticsDashboard()` is the one
    round trip `/automation` makes for every section below, and
    `getBusinessOverview`/`getRevenueAnalytics`/`getProfitAnalytics`/
    `getProductAnalytics`/`getSupplierAnalytics`/`getMarketplaceAnalytics`/
    `getMarketAnalytics`/`getDataQuality` are the named entry points a
    future CEO AI assistant (Milestone 12) queries facts through, per the
    brief's §21 — each currently reads its slice off the one dashboard call
    rather than running a second live query.
- **Monitoring integration, closing genuinely dead configuration**: three
  event types had been reserved in `monitoring/registry.ts`'s
  `EVENT_TO_JOB_MAPPING` since Milestone 8 but never actually emitted —
  `PRODUCT_MARGIN_DROPPED`/`PRODUCT_MARGIN_RECOVERED`,
  `PRODUCT_NO_LONGER_PROFITABLE`/`PRODUCT_BECAME_PROFITABLE`, and
  `PRODUCT_REFUND_RATE_INCREASED`. `profitabilityMonitor.ts` now also
  computes a real channel-aware margin projection (via `channels.ts`, the
  same engine, when the subject carries `channel`/`connectorKey` —
  optional fields, so every pre-Milestone-10 subject/test keeps working
  unchanged) and tracks a *frozen reference margin* while a product is in
  a dropped state, so a margin that merely stops falling is never
  misreported as "recovered" — recovery requires climbing back above the
  threshold. A crossing into unprofitable enqueues `product_price_review`
  with the full rich payload that handler has required since Milestone 7.
  `performanceMonitor.ts` gained `PRODUCT_REFUND_RATE_INCREASED`, mirroring
  the existing `PRODUCT_RETURN_RATE_INCREASED` check exactly (refunds and
  returns are tracked as genuinely different facts, per
  `REFUND_REASONS_COUNTED_AS_RETURNS`'s existing documented heuristic). No
  new monitor, no new job type beyond what already existed unused — revenue
  decline, sales decline, supplier deterioration, marketplace desync and
  market profitability deterioration were already fully covered by
  Milestone 8/8.5/9's monitors and needed no duplication.
- **`src/lib/demo/analytics.ts`**: the 10 required demo scenarios (strong
  growth; revenue decline; profit decline despite revenue growth; a
  product becoming loss-making; supplier deterioration; marketplace
  underperformance; an international market performing well — reusing
  Milestone 9's own `demoMarketExpansionScenarios()` rather than
  re-deriving country/FX/compliance facts a second time; incomplete
  profit data; advertising unavailable; fulfilment deterioration), each
  computed by calling the real builder functions against deliberately
  chosen fixture facts, never a hardcoded narrative string.
- **UI**: `/automation` gained a "Business analytics" area — revenue &
  profit (with period-over-period comparison badges), channel performance,
  top/worst-performing products, supplier health, fulfilment health, open
  business alerts, data-quality warnings, and an honestly-`UNAVAILABLE`
  advertising card — plus the 10 demo scenario cards in demo mode. No new
  route: the existing automation/CEO-intelligence page was extended, per
  the brief's own instruction not to build a separate dashboard where one
  already fits.
- **Two real bugs found by deliberate multi-currency probing, not by
  inspection** (Milestone 10 §22's explicit instruction): `channels.ts`'s
  `buildChannelProfiles` and `projectChannel` had *always* built several of
  their own cost Money values (Amazon FBA fulfilment, both channels'
  default ad spend, Shopify's payment fee, the default packaging cost) by
  calling `fromMajor(x)` with no explicit currency — silently defaulting to
  GBP regardless of the product's actual `sellingPrice.currency`. This had
  been dormant since Milestone 1 because every prior caller only ever
  priced products in GBP; Milestone 10's analytics is the first path that
  could genuinely receive a non-GBP `channel_products.currency` row, and it
  crashed immediately with an uncaught `CurrencyMismatchError` inside
  `calculateProfitability`'s own `add()` calls. Fixed by building every
  Money value in the input's own currency throughout both functions — a
  real, previously-latent bug in shared production code, not new code, now
  covered by regression tests. Separately, `analytics/channelAnalytics.ts`'s
  `buildChannelProfitRollup` was changed to filter out (and honestly count,
  never silently sum) any product whose *own* currency differs from the
  channel's reporting currency, so a single mismatched listing can never
  crash — or corrupt — a whole channel's rollup.

**IMPLEMENTED AND VERIFIED:**

- Period resolution and previous-equivalent-period comparison for all 9
  periods, including the calendar-anchored same-elapsed-fraction rule
  (`tests/sales-aggregation-periods.test.ts`).
- Sales, profit, product, channel, supplier and fulfilment analytics
  builders, each proven against genuinely adversarial fixtures: empty
  data, missing cost, missing price, a mismatched-currency supplier cost,
  zero revenue in the current period, zero revenue in *both* periods
  (a real `0%`, not `null`, not a crash), partial data that must not
  skew the rest of a rollup, and channel divergence (the same product
  profitable on one channel, loss-making on another, never averaged).
- The two real `channels.ts`/`channelAnalytics.ts` bugs above, found and
  fixed via deliberate multi-currency bug-hunting
  (`tests/analytics-bug-hunting.test.ts`).
- The three previously-dead monitoring event types, now genuinely emitted
  and enforced against `EVENT_TO_JOB_MAPPING`'s strict per-event job
  contract, including the rich `product_price_review` payload
  (`tests/monitoring-compliance-profitability-performance.test.ts`,
  `tests/monitoring-registry.test.ts`).
- All 10 demo scenarios, computed through the real builder functions
  (`tests/demo-analytics.test.ts`).
- `/automation`'s new "Business analytics" area confirmed live in the
  browser with no console errors, in demo mode (every KPI an honest zero
  or `UNKNOWN`, all 10 demo scenario cards rendering with real computed
  figures) — plus `/opportunities/[id]`, `/orders`, `/marketplaces`,
  `/approvals` and `/report` re-checked for regressions after the shared
  `channels.ts` fix, with the opportunity page's existing profitability
  figures byte-identical to their pre-Milestone-10 values.

**IMPLEMENTED BUT NOT LIVE-VERIFIED:**

- `analytics/liveAnalyticsFacts.ts`'s own Supabase query composition —
  proven against the same schema and column names every other
  `server-only` query in this codebase already uses, but never against a
  real deployed Postgres project, because none exists in this environment.
  Same standing boundary as every live Supabase path since Milestone 1.

**REQUIRES PRODUCTION INFRASTRUCTURE:**

- A real advertising connector (Amazon Ads, Meta, Google Ads, TikTok Ads)
  — `advertisingAnalytics.ts` defines the interface; nothing implements it,
  by design, until real credentials and an API integration exist.
- Real order/fulfilment/supplier-cost history at scale, to confirm
  `liveAnalyticsFacts.ts`'s pagination bounds (500 rows/page, 20 pages) are
  the right ceiling for an actual trading business, not just this
  environment's demo data.

**NOT IMPLEMENTED (deliberately, not a hidden gap):**

- No interactive period selector on `/automation` — the dashboard defaults
  to "last 30 days" and states its own period and comparison window
  explicitly in the section header; a client-side selector is a UI
  addition, not an analytics-architecture one, and was left for a later
  pass rather than adding a client component this milestone did not need.
- Realized (as opposed to projected) historical profit reconstruction —
  `profitAnalytics.ts` projects *current* price and cost through the
  engine, the same convention every other profitability view in this
  codebase already follows, because `order_items.unit_cost_minor` is only
  populated where a sale's real cost was actually captured; inventing a
  historical figure where it was not would be exactly the failure mode
  `docs/PRINCIPLES.md` §1 forbids.
- Order-level cancellation-rate analytics distinct from fulfilment
  cancellation — `fulfilmentAnalytics.ts` covers fulfilment-record
  cancellation (a real, queried fact); a separate order-status-level
  cancellation metric was judged redundant with it for this pass.

**Verified:** 770 tests (up from 702 after Part 14's monitoring work, up
from 687 at the start of this milestone); no new migrations (25
migrations, 72 tables, unchanged — every metric reads existing tables);
typecheck, lint and `npm run build` all clean; `db:verify` re-run clean;
`/automation`, `/opportunities/[id]`, `/orders`, `/marketplaces`,
`/approvals` and `/report` confirmed live in the browser with no console
errors; `informax-site` confirmed untouched throughout (git status checked
before and after).

## Milestone 11 — CEO Command Centre ✅ complete

The dashboard the owner actually reads every day, at `/` (the existing
"Dashboard" nav entry — no new route). Milestone 10 built the business
intelligence *facts*; this milestone composes them, plus Milestone 6/8's
automation and monitoring status and the existing approvals queue, into
one executive view — and adds only genuinely new orchestration logic
(which alert outranks which, which classification an area's health boils
down to), never a second calculation of anything Milestone 6–10 already
computed. The layering the brief itself specified:

```
Operational systems -> Authoritative engines -> Analytics & BI (M10)
-> CEO Command Centre (M11) -> CEO
```

- **`src/lib/ceo/`** (new module, mirroring `analytics/`'s one-file-per-
  concern shape, kept deliberately separate from it per the layering
  above):
  - `types.ts` — `Priority`, `HealthArea`/`HealthStatus`
    (`healthy`/`watch`/`at_risk`/`critical`/`unknown`), `CEOCommandCentre`,
    `CEODemoScenario`.
  - `priorities.ts` — `buildPriorities`, the deterministic executive
    priority queue ("what needs my attention" and "your priorities today"
    are the same list, shown once, per the brief's own "do not create a
    second alert engine" instruction). Maps Milestone 10's
    `analytics.alerts` straight through (revenue/profit decline,
    data-quality gaps, supplier at-risk/unavailable — never re-derived),
    and *adds* only what Milestone 10 did not already alert on:
    channel-specific loss-making products, automation health (paused/
    failed/dead-lettered), pending approvals (escalated to critical only
    when genuinely within 24h of expiry — a real fact, not a guess),
    compliance rechecks, and fulfilment problems. Sorted critical-first,
    then most-recent-first — deterministic and stable.
  - `healthScorecard.ts` — `buildBusinessHealthScorecard`, eight areas
    (financial/product/supplier/marketplace/fulfilment/compliance/
    automation/data quality), each a classification with a stated reason,
    built entirely from existing counts and classifications
    (`SupplierHealth.status`, `MarketConnectorStatus`, `DataQualitySummary`).
    The overall status is the single worst area — never a separately
    invented blended score, and never hidden behind unrelated
    healthy/unknown areas.
  - `repository.ts` (`server-only`) — `getCEOCommandCentre()`, the one
    composition function the whole page calls. Uses `Promise.allSettled`
    (never a bare `Promise.all`) across `getAnalyticsDashboard`/
    `getMonitoringStatus`/`getAutomationStatus`/`getPendingApprovals`, so
    one source failing falls back to a safe empty/unknown value and is
    recorded in `dataSourceFailures`, rather than taking the whole
    dashboard down — the brief's explicit "must fail safely" requirement.
- **`src/components/dashboard/MetricStat.tsx`**: the fact-first metric
  tile (value + comparison badge when known; an honest UNKNOWN/STALE/
  UNAVAILABLE badge plus its source when not) extracted out of
  `/automation`'s page so both it and the new `/` page render the exact
  same `Metric<T>`/`PeriodMetric<T>` shape identically, rather than two
  copies that could drift.
- **`src/lib/demo/ceo.ts`**: the 10 required demo scenarios (healthy and
  growing; revenue growth but declining profit; critical supplier
  failure; multiple loss-making products; marketplace underperformance;
  international expansion opportunity; stale FX/data-quality warning;
  automation emergency stop; a pending approval expiring within 24h;
  multiple simultaneous issues), each computed by calling the real
  `buildPriorities`/`buildBusinessHealthScorecard` functions against
  deliberately chosen fixture facts — never a hardcoded narrative string.
- **UI** (`src/app/(dashboard)/page.tsx`, fully rebuilt): an emergency-stop
  banner (shown above everything else when active); a data-source-failure
  banner; "What needs your attention" (the priority queue); an executive
  summary (revenue/net revenue/orders/AOV/refunds/refund & return rate/
  known net margin, each with a period-over-period comparison badge, and
  an explicit `*Data incomplete` marker when the margin is not fully
  known); the business health scorecard; channel performance; top
  performers / problem products (kept channel-specific throughout —
  never "Product X is unprofitable" as a blanket claim); supplier health
  plus the existing per-channel supplier approval table; fulfilment
  health; international markets (real connector status, `planned` never
  shown as live); automation health; an approvals summary; the existing
  Milestone 1/2 opportunity-intelligence section (kept, not replaced —
  genuinely different facts from Milestone 10's realized-performance
  view); a dedicated "Can I trust these numbers?" data-quality section;
  the existing stock/compliance detail cards; and a combined recent-
  activity feed from real `domain_events` and `automation_actions` rows
  (never a second audit log). The old page's `getBusinessSummary()`/
  `getChannelSummaries()` calls (Milestone 1, hardcoded-empty stubs in
  live mode) and `getProducts()`-based winners/losers were removed
  entirely, replaced by Milestone 10's real data.
- **A real, previously-latent bug found via live browser verification,
  not by inspection**: two of the ten demo scenarios computed their
  "current vs previous period" comparison using the *same* window bounds
  for both — `aggregateSalesWindow(currentLines, [], period.start,
  period.end)` and `aggregateSalesWindow(previousLines, [], period.start,
  period.end)` — so the previous period's own order line (dated weeks
  earlier) fell outside the window it was being checked against,
  aggregated to zero, and produced `comparePeriods(revenue, 0)` ->
  `percentChange: null` per Milestone 10's own divide-by-zero rule. The
  page rendered "Revenue: null% vs the previous period" — a defect this
  session's own automated tests did not catch (they checked for the
  literal strings `"undefined"`/`"NaN"`, not `"null"`) but a live render
  in the browser did. Fixed by computing `previousEquivalentPeriod(period)`
  for the previous window, exactly as `demo/analytics.ts` (Milestone 10)
  already did correctly — a regression test was added to catch this
  specific class of mistake in future demo fixtures.

**IMPLEMENTED AND VERIFIED:**

- `buildPriorities`: deterministic critical-first ordering (proven with
  50 simultaneous synthetic alerts), channel-specific loss-making
  priorities, emergency-stop always critical, a paused category always
  medium (never critical), approval-expiry-based severity escalation, and
  that every alert Milestone 10 already produced is mapped through
  exactly once, never re-derived (`tests/ceo-priorities-health.test.ts`).
- `buildBusinessHealthScorecard`: every area unknown in demo mode, a
  genuinely healthy live business reporting every area healthy, the
  overall status always the single worst area, every non-healthy/
  non-unknown area carrying a stated reason, and `planned` markets never
  counting against marketplace health.
- **A second real bug found and fixed via this milestone's own test
  suite**: the data-quality health area was initially at least `watch`
  for *every* business, forever — because "no advertising connector
  configured" (Milestone 10, `severity: 'info'`, permanently true in this
  codebase) was enough on its own to mark `dataQuality.overallStatus` as
  `incomplete`, and the scorecard treated any `incomplete` status as at
  least `watch`. Fixed so only `warning`/`critical`-severity data-quality
  issues affect this area's health; a purely informational, permanent,
  unresolvable gap like "no ad connector exists" is surfaced prominently
  in the dedicated data-quality section instead, without depressing the
  scorecard forever.
- `getCEOCommandCentre()`'s graceful degradation: each of the four
  fallback shapes (`fallbackAnalyticsDashboard`/`fallbackMonitoringStatus`/
  `fallbackAutomationStatus`/an empty approvals array) is structurally
  identical to the "genuinely no data yet" fixtures already exercised
  throughout `tests/ceo-priorities-health.test.ts` and `tests/demo-ceo.test.ts`
  — proven safe as input to `buildPriorities`/`buildBusinessHealthScorecard`,
  though the `Promise.allSettled` wiring itself could not be unit tested
  directly (see below).
- All 10 demo scenarios, computed through the real builder functions
  (`tests/demo-ceo.test.ts`).
- `/` (the new CEO Command Centre), `/automation`, `/orders`,
  `/marketplaces`, `/approvals` and `/opportunities/[id]` confirmed live
  in the browser with no console errors, including a working drill-down
  click from the priority queue straight through to `/approvals`.

**IMPLEMENTED BUT NOT LIVE-VERIFIED:**

- `getCEOCommandCentre()`'s own composition and its `Promise.allSettled`
  fallback wiring — this function is `server-only` (like every repository
  function since Milestone 1) and cannot be imported into a Vitest file
  at all, so it is exercised only by its pure sub-functions
  (`buildPriorities`/`buildBusinessHealthScorecard`) receiving the same
  fallback shapes it would produce, and by the live browser check above,
  never against a real deployed Postgres project.

**REQUIRES PRODUCTION INFRASTRUCTURE:**

- Everything Milestone 10 already listed here (a real advertising
  connector; real order/fulfilment history at scale) — this milestone
  added no new infrastructure requirement of its own.

**NOT IMPLEMENTED (deliberately, not a hidden gap):**

- The AI CEO briefing — needs Milestone 12's chat/tool layer; this
  milestone makes `getCEOCommandCentre()` and `buildPriorities` the exact
  facts a future assistant should query, per the brief's §21, rather than
  build a chat interface here.
- Products-ready-to-scale gating, and dedicated finance/advertising/
  product "command centres" beyond what channel performance, supplier
  health and fulfilment health already cover — the original brief's scope
  for these was folded into what Milestone 10's real data already
  supports; building separate dedicated sections for them without new
  underlying facts would be decorative, not functional.
- An interactive period selector — the dashboard states its "last 30
  days" period and comparison window explicitly in its own header text;
  a client-side selector was judged out of scope for the same reason
  Milestone 10 deferred it (a genuine UI feature addition, not an
  analytics-architecture one).
- A dedicated cashflow-warning card — the pre-existing `getCashflow()`
  (Milestone 1) still returns a hardcoded-empty result in live mode; this
  milestone did not extend it, and deliberately does not surface a
  cashflow card that would silently never fire, since doing so would
  misrepresent this area's completeness. A real cashflow-forecasting pass
  remains a documented, pre-existing gap (`docs/MILESTONES.md`'s
  "Cross-cutting, ongoing" Payments and cashflow section), not part of
  Milestone 10 or 11's brief.

**Verified:** 792 tests (up from 770); no new migrations (25 migrations,
72 tables, unchanged — every figure is composed from Milestone 6–10's
existing reads); typecheck, lint and `npm run build` all clean;
`db:verify` re-run clean; `/`, `/automation`, `/orders`, `/marketplaces`,
`/approvals` and `/opportunities/[id]` confirmed live with no console
errors; `informax-site` confirmed untouched throughout (git status
checked before and after).

**Audit & hardening pass (same day, follow-up session, see
`HANDOVER.md` §27 for full detail):** a genuine multi-currency sales
aggregation gap (in this milestone's own `getCEOCommandCentre`
dependency chain via Milestone 10's analytics, and separately in
Milestone 8.5's `discoverSalesPerformance` live monitor-subject
discovery) and a genuine compliance-visibility gap (blocked/
review-required products reached `/compliance` directly but not the
priority queue or health scorecard) were found and fixed. `getComplianceIssues()`
(the pre-existing Milestone 1/2 compliance repository, not a new engine)
is now composed into `buildPriorities`/`buildBusinessHealthScorecard`
alongside the four sources already listed above, still via
`Promise.allSettled`, still failing safe to `[]`. 796 tests (up from
792); typecheck, lint, `npm run build` and `db:verify` re-confirmed
clean; no schema change.

## Milestone 12 — Commerce Intelligence chat ✅ complete (Phase 1: read-only)

An AI chat interface answering real questions about the actual business,
grounded entirely in facts read from the existing intelligence layer —
never raw, unrestricted database access, and never a second intelligence
engine. Responses distinguish verified facts, calculated conclusions,
recommendations, and genuine uncertainty, and the system says so plainly
when the required data is not available. Credentials never enter the
conversation. Full detail in `docs/ARCHITECTURE.md`'s `src/lib/ai/`
section, `docs/SECURITY.md`'s Milestone 12 section (the full threat
model), `docs/API.md`'s `POST /api/chat` section, and `HANDOVER.md` §28.

As built: `ai/factBundle.ts`'s `buildFactBundle` composes
`getCEOCommandCentre()` (Milestone 11) plus `getOpportunities`/
`getIntelligenceSummary`/`getSuppliers` — the same facts `/`, `/opportunities`,
and `/suppliers` already render, never recalculated. The model is
structurally never given tool/function-calling access (no request this
codebase constructs ever includes a `tools` field), which is what actually
prevents it from querying, mutating, or executing anything — a textual
defence (guardrails, a fixed system prompt) is layered on top but not
relied on alone. A deterministic, no-network fallback (`offlineAnswer.ts`)
serves every answer whenever `ANTHROPIC_API_KEY` is not configured, so the
chat is fully functional and fully tested with zero credentials, the same
"demo mode is first-class" posture the rest of this codebase already
takes.

**Verified:** 845 tests (up from 796); typecheck/lint/build/`db:verify`
all clean; no schema change (conversation history is client-round-tripped,
never persisted); `/chat` confirmed live end-to-end in the browser,
including a real multi-turn conversation and every reference chip
resolving to a real page. **Not live-verified:** actual Anthropic API
behaviour under a real key — no `ANTHROPIC_API_KEY` exists in this
environment, so every browser check exercised the offline fallback path;
the live provider's request/response *shaping* is unit tested, but whether
a real model's answers stay fact-first in practice is unverified.

**Deliberately out of Phase 1's scope:** any interaction mode beyond "ask"
(Milestone 13's analyse/recommend/execute), and conversation persistence
(no new table — a scope choice, not an oversight, per §13's
"don't introduce unnecessary migrations").

## Milestone 13 — Commerce Intelligence: Analyse, Recommend & Propose ✅ complete (Execute intentionally deferred)

Originally scoped as "AI actions" with four interaction modes (ask,
analyse, recommend, execute). Rescoped, deliberately, after reviewing
Milestone 12: execution was judged too consequential to build in the same
pass as recommendations, so this milestone builds Analyse (already
Milestone 12), Recommend, and Propose only — Execute remains exactly the
pre-existing `automation/` policy engine and `/approvals` page, untouched,
reached only through a real owner approval. The AI is never the source of
authority: rules, permissions, validation and the action layer built in
Milestones 5–6 remain authoritative regardless of what the AI recommends,
enforced structurally (the model is never asked to produce the actionable
proposal structure at all — see `docs/ARCHITECTURE.md`'s
`src/lib/ai/actions/` section and `docs/SECURITY.md`'s Milestone 13
section), not just by instruction.

A finite, 8-member `ProposedActionType` vocabulary exists
(`UPDATE_PRICE`/`CREATE_LISTING`/`PAUSE_LISTING`/`REVIEW_SUPPLIER`/
`REVIEW_PRODUCT`/`ADJUST_INVENTORY_THRESHOLD`/`REVIEW_ADVERTISING`/
`REQUEST_APPROVAL`), but only `UPDATE_PRICE` and `REQUEST_APPROVAL`
currently reach a real `/approvals` entry — the other six are recognised,
never silently dropped, but honestly `not_executable` until a real domain
engine exists for each (documented per-type in `HANDOVER.md` §29 and in
`ai/actions/validate.ts`'s own code).

**Verified:** 876 tests (up from 845); typecheck/lint/build/`db:verify`
all clean; no schema change; `/chat` confirmed live end-to-end for a
price-change proposal (entity/channel resolved correctly, honest
demo-mode limitation reported) and a `REQUEST_APPROVAL` proposal (reached
`requires_approval`, "Request approval" button worked, honest demo-mode
error on click, no crash). **Not live-verified:** the real `ai_decisions`
write path against a live Supabase project, and live Anthropic API
behaviour (unchanged from Milestone 12) — see `HANDOVER.md` §29.

**A genuine bug found and fixed via browser verification**: the live
price-lookup path had no demo-mode branch and threw a `500` in this
environment's actual default (demo) state — every other repository
function in this codebase checks `session.isDemo` first; this one didn't.
Fixed; see `HANDOVER.md` §29 for the full story.

## Milestone 14 — Advertising intelligence ✅ complete (Analyse/Recommend/Propose layer; live platform integrations and automated execution deferred)

Advertising platform integrations (Amazon Ads, Meta, Google, TikTok as
applicable) evaluated on contribution after advertising, never on ROAS alone —
a campaign can carry high revenue or a strong ROAS and still be unprofitable
once real costs are included. Automated advertising actions carry account,
daily and per-product limits, maximum percentage changes, approval thresholds,
cooldowns, rollback logic and audit logging, with no path to unlimited
automated spend.

**What this pass actually delivered**: the `advertising` table already
existed (Milestone 1's schema) with no live data ever written to it, so
this milestone is entirely an intelligence layer over real spend/revenue
figures, not a schema change — a deterministic classification engine
(`analytics/advertisingAnalytics.ts`: `wasted_spend`/`poor_profitability`/
`high_acos_low_roas`/`declining_performance`/`scale_opportunity`/`healthy`/
`insufficient_data`, each traceable to a measured fact or a named,
configurable threshold, never an LLM call), an org-wide scorecard using
the same "worst campaign wins" rule as Milestone 11's health scorecard,
full CEO Command Centre integration (priorities, health area, and the
compliance-block override that keeps a non-compliant product's campaign
from ever appearing as an unrestricted scaling recommendation), Commerce
Intelligence chat integration (Milestone 12/13's `FactBundle`/
`intentExtraction`/`validate`/`propose` pipeline extended to campaigns,
never a second AI pathway), and a new `/advertising` page. **Not**
delivered, deliberately: no advertising platform connector exists (Amazon
Ads, Meta, Google, TikTok), so there is no real spend data source beyond
whatever is written into the `advertising` table by hand or by a future
connector, and no automated advertising action exists at all —
`PAUSE_CAMPAIGN`/`INCREASE_BUDGET`/`DECREASE_BUDGET` are recognised
vocabulary but honestly `not_executable`; only `REVIEW_CAMPAIGN` (a pure
escalation, identical in kind to Milestone 13's `REQUEST_APPROVAL`)
reaches a real `/approvals` entry. The account/daily/per-product spend
limits, cooldowns and rollback logic this section originally scoped
belong to a future milestone that builds a real connector and a real
automated-execution path — building that automation policy now, with
nothing real to execute against, would be exactly the kind of premature
abstraction this codebase avoids elsewhere.

**Verified:** typecheck/lint/build/`db:verify` all clean; no schema
change (72 tables, unchanged); `/advertising`, `/`, `/chat`, `/approvals`
and `/compliance` all confirmed live in the browser in demo mode with no
console errors — `/advertising` shows an honest empty scorecard plus all
seven demo scenarios (computed via the real classification engine against
fixed fixture data), and asking chat "What is my advertising ROAS and are
any campaigns wasting money?" honestly answered "No advertising campaign
data for this period" in the same session the demo scenarios render in,
confirming demo scenarios never leak into the live data path. **Not
live-verified:** a real `REVIEW_CAMPAIGN` proposal actually reaching
`/approvals` end-to-end (this environment's demo session has no real
campaign data to match a chat message against, and `validate.ts`/
`propose.ts`'s campaign paths are `server-only`, so — like Milestone 13's
price-change path — they cannot be imported into Vitest either); real
Anthropic API behaviour (unchanged from Milestone 12/13, no
`ANTHROPIC_API_KEY` in this environment).

**A real correctness gap found and fixed**: `ceo/priorities.ts`'s
advertising section was missing a branch for `high_acos_low_roas` — a
real `severity: 'high'` classification that the health scorecard already
surfaced but that never reached the CEO priority queue. See
`docs/SECURITY.md`'s Milestone 14 section and `HANDOVER.md` for the full
story.

## Live Advertising Connector & Controlled Automation ✅ complete (referred to as "Milestone 15" in code/tests/HANDOVER.md — see the numbering note below)

Extends directly from Milestone 14 (Advertising Intelligence &
Optimisation): a provider-agnostic `AdvertisingProvider` connector
interface (`src/lib/advertising/connectors/`, all four platforms
registered — one real-but-not-live-verified Amazon Ads connector, one
demo connector, three honest not-yet-implemented stubs), a validated sync
engine writing into the same pre-existing `advertising` table Milestone 14
already used (four new nullable columns only — `provider`/
`external_account_id`/`currency`/`synced_at` — never a parallel table), and
a controlled-automation policy/execution pipeline
(`src/lib/automation/advertisingAutomation.ts`/`advertisingExecution.ts`)
that structurally cannot auto-permit a spend-changing campaign action for
any input, this milestone — a `PAUSE_CAMPAIGN`/`INCREASE_BUDGET`/
`DECREASE_BUDGET` action can only ever reach `blocked` or
`require_approval`. `advertisingAnalytics.ts`'s deterministic
classification engine (Milestone 14) is completely untouched. No real
platform credentials exist in this environment, so nothing here has
executed a real advertising API call; see `HANDOVER.md` §31 and
`docs/SECURITY.md`'s Milestone 15 section for the full, honest account of
what is real code versus what remains an honest stub.

**Numbering note**: this is a different piece of work from the
"Milestone 15 — International expansion" entry immediately below, which
predates it in this document and was already substantively delivered back
in Milestone 9. The two share a number only because this advertising work
was requested as a direct continuation of Milestone 14 without an explicit
new number; `HANDOVER.md` §31 has the full explanation. The next genuinely
new initiative after this one should be numbered 16, not a second attempt
at 15.

## Milestone 15 — International expansion

Country/marketplace/currency/tax/shipping/documentation modelled explicitly,
with product-marketplace eligibility, supplier delivery capability, delivery
acceptability, profitability, documentation and tax configuration each
assessed independently per destination. Unknown resolves to review, never to
approval, exactly as in Milestone 2's compliance model.

**Note:** Milestone 9 already delivered this milestone's foundational
architecture — the country/currency/marketplace market model
(`src/lib/markets/catalog.ts`), FX intelligence with provenance and
freshness (`src/lib/fx/`), country-aware compliance delegation
(`countryCompliance.ts`), market-specific profitability via the one
existing engine, and a deterministic expansion-recommendation engine
(`expansion.ts`), all wired into monitoring and automation end to end. What
remains scoped to this milestone is genuinely new country rulesets beyond
GB (real legal/tax research, not an architecture change), real marketplace
connectors for the `planned` entries in `MARKET_CATALOG`, a real FX
provider/connector to replace the demo rate seed, real supplier
destination-capability data to replace the seed facts, and live subject
discovery for the `market_expansion` monitor (currently a documented gap
in `liveSubjects.ts`). Read `docs/MILESTONES.md`'s Milestone 9 section and
`HANDOVER.md`'s corresponding section before starting any of this — the
model is designed to extend without a schema redesign; it should not be
rebuilt.

## Milestone — Headless storefront foundation ✅ complete (Phase 3 of the customer-facing store)

A real, customer-facing storefront at `src/app/(storefront)` (served under
`/shop/*`), separate from the operator dashboard: Shopify's Storefront API
for catalogue/cart (`src/lib/shopify/storefront.ts` — a new, deliberately
separate credential from the Admin API connector, structurally unable to
read orders/customers or write products), its own scoped design system,
and real home/collection/product/cart pages. Checkout is always Shopify's
own hosted checkout via `cart.checkoutUrl` — no payment code exists in
this codebase. No live Storefront API token exists in this environment,
so every page correctly renders an honest "store not connected yet" state
rather than a fabricated product grid. Full detail in `HANDOVER.md` §56.

**Deliberately deferred:** an animated cart drawer (a real cart *page*
ships instead); collection filters beyond sort (no product tag/metafield
convention exists yet to filter against honestly); moving the admin
dashboard off `/` to free up the storefront's own root path (a production
domain-split decision, not an architecture gap).

## Milestone — Product Intelligence: enrichment, quality, risk, capital and a deterministic recommendation ✅ complete (Phase 4 of the customer-facing store)

Turns a raw, already-imported product into a decision-ready one: "is this
product actually worth selling?", answered deterministically before any
publish/channel decision is made. Reuses rather than duplicates: the real
`calculateProfitability`/`assessProfitabilityGate` engine
(`@/lib/profitability`) for every cost figure, the existing 19-component
`scoreOpportunity` engine (`@/lib/products/scoring.ts`) for market
opportunity, the existing compliance assembler
(`getChannelReadiness`/`assessCompliance`), and two tables —
`product_scores` and `product_health` — that already existed with exactly
the right shape and had never been written to by any code. Two genuinely
new engines fill the actual gap: a Product Quality Score (data
completeness, not market fit) and capital-aware ranking (reusing
`Profitability.cashRequiredPerUnit` as the real per-order cash figure,
checked against a configurable, nullable `available_operating_capital` —
never assumed zero or unlimited).

**As built:** `src/lib/products/intelligence/` — `enrichment.ts`
(normalises raw facts, honestly gapped, never invented), `qualityScore.ts`
(persists to `product_health`), `riskScore.ts` (new
`product_risk_scores` table, mirroring the existing two), `capitalRanking.ts`,
`pricingEngine.ts` (finds `recommended_price`/`minimum_viable_price` by
binary-searching the *real* profitability engine for a target margin,
rather than a second pricing formula), `recommendation.ts` (the
deterministic STRONG_CANDIDATE/CANDIDATE/REVIEW_REQUIRED/LOW_PRIORITY/
DO_NOT_SELL ladder — profitability and supplier failures are always
DO_NOT_SELL, a failed or unassessed compliance verdict is always
REVIEW_REQUIRED, poor capital efficiency is LOW_PRIORITY, and AI has no
ability to override any of it), and `assemble.ts` (the one orchestrator
that loads real data — including a live Shopify Storefront API read of
the product's own images/description/variants via its GID — runs every
engine, and persists the result). New migration 0037/0038:
`product_risk_scores`, `product_intelligence` (current state, pointing at
the three score rows it was computed from rather than copying their
breakdowns) and `product_intelligence_history` (append-only), plus seven
new `business_settings` columns (`min_quality_score`, `max_risk_score`,
`target_net_margin_pct`, `advertising_allowance_pct`, and three nullable
capital columns), wired into the Settings page. UI: a "Product
intelligence" panel on the product detail page with a "Recalculate"
button — a deliberate, attributable action, never scheduled automation.
`AuditAction` needed no new value: `PRODUCT_SCORED` had existed since
Milestone 1, reserved for exactly this, unused until now.

**Deliberately out of scope, per the brief:** DSers and any other raw
supplier feed (already correctly `PLANNED` in
`suppliers/connectors/registry.ts`, confirmed by inspection rather than
re-guessed); automatic publishing or supplier purchasing from a
recommendation; a REST API surface (this is an internal admin operation,
so it follows this codebase's existing pattern of Server Actions +
repository reads for internal use, not a new `/api/*` route — no external
caller needs one yet, see `docs/API.md`).

## Milestone — Supplier discovery & product ingestion ✅ complete (Phase 5 of the customer-facing store)

Turns raw supplier listings into real products, without ever skipping
Phase 4's intelligence layer: SUPPLIER SOURCE → candidate capture →
duplicate check → PRODUCT RECORD / SOURCE LINK → Phase 4's
`computeProductIntelligence`, completely unchanged → human review. Audited
first, and the audit reshaped the whole design: `product_research`
(Milestone 1, `0002`) already existed as exactly the right "product
candidate" shape — `product_id` nullable (may or may not have become a
real product yet), `research_source` already including
`'supplier_catalogue'` — and was completely unused by any application
code. A closer read after `0010` (Milestone 2) found even more already
built: a `candidate_status` enum (`new`/`scored`/`promoted`/`rejected`/
`duplicate`/`archived`, reused directly rather than a second one — an
earlier migration draft nearly added a duplicate before `db:verify`
caught the collision), `estimated_unit_cost_minor`/
`estimated_shipping_minor`/`currency`, and `rejected_reason`, all already
there. Only three columns were genuinely missing: a supplier link,
supplier SKU, and a self-reference for duplicate matching. `supplier_products`
(Milestone 1, `0003`) already supports multiple offers per product — the
entire "PRODUCT SOURCE HISTORY / SUPPLIER OFFER MODEL" requirement,
needing no schema change at all.

**As built:** `src/lib/suppliers/discovery/` — `duplicateDetection.ts`
(supplier SKU / source reference / cross-supplier barcode matching, never
silently merging — a match is flagged, not blocked), `offerComparison.ts`
(deterministic `compareSupplierOffers`, explaining a preferred supplier
against cost/delivery/reliability/tracking/returns, never "cheapest
wins" by default, and an out-of-stock offer is never preferred regardless
of price), `validation.ts` (pure candidate validation, kept separate from
the server-only orchestrator for the same reason `products/decision.ts`
is kept separate from `decisionExecutor.ts`), `ingestion.ts`
(`captureCandidate`/`importCandidate`/`rejectCandidate` — the one
orchestrator; `importCandidate` creates a real `products` row at stage
`discovered` plus a real `supplier_products` offer, then calls Phase 4's
`computeProductIntelligence` unchanged — no scoring, profitability,
capital, or recommendation logic is duplicated here), and
`repository.ts` (queue + offer reads). New migration 0039: three columns
on `product_research`, two new `business_settings` limits
(`max_candidates_per_discovery_run`, `max_products_pending_review`) —
every other discovery criterion (`max_supplier_cost_minor`,
`min_net_margin_pct`, `max_delivery_days`, `max_risk_score`,
`min_quality_score`, `available_operating_capital_minor`,
`blocked_categories`/`allowed_categories`, `preferred_countries`) already
existed from Phase 4 or Milestone 1 and is reused, not duplicated.

**Connector capabilities** (`suppliers/connectors/types.ts`'s
`ConnectorDescriptor`) gained an honest `capabilities` declaration
(`discoverProducts`/`readProducts`/`readStock`/`readShipping`/
`placeOrders`/`cancelOrders`/`trackingUpdates`) on all eight existing
connectors — the manual connector and the seven `PLANNED` categories
(DSers-compatible, Syncee-type, EPROLO-type, CJ-type, AutoDS-type, direct
API, CSV feed). `placeOrders`/`cancelOrders` are `false` on every single
one without exception — asserted directly in
`tests/supplier-connector-capabilities.test.ts` — since nothing in this
codebase is permitted to spend money automatically, regardless of what a
real platform might technically support.

**UI:** `/suppliers/discovery` — manual candidate capture form (the
"MANUAL SUPPLIER ENTRY" workflow), and the discovery queue with
Import/Reject actions (a possible-duplicate candidate requires an
explicit "import anyway" acknowledgement, never a silent override). A new
"Supplier offers" panel on the product detail page shows every real
offer for that product with the comparison and preferred-supplier
explanation. No "auto-publish all" or bulk-import control exists.

**Tested:** 32 new tests (validation, duplicate detection, offer
comparison, connector capability honesty) — 1564 total (was 1532).
`npx tsc --noEmit`, `npm run lint`, `npm run build` (1 new route,
`/suppliers/discovery`), `npm run db:verify` (79 tables, unchanged — this
migration only adds columns) all clean. **Verified live in the browser**
(demo mode, no Supabase credentials exist): `/suppliers/discovery` and
the Settings page's new "Supplier discovery" card both render their
honest states with no console errors.

**Deliberately not built, per the brief's own explicit instructions:**
CSV/catalogue batch import (the manual single-candidate path already
proves capture → duplicate-check → import end to end; a batch importer
would wrap the same `captureCandidate` function and is safely deferred);
any live connector beyond manual entry (DSers and the rest remain
honestly `PLANNED`/`NOT_CONFIGURED` — no scraping, no reverse-engineered
APIs, no fabricated OAuth); automatic publishing or supplier purchasing
from a recommendation; a REST API surface (Server Actions + repository
reads, matching this codebase's existing internal-operation pattern, see
`docs/API.md`).

## Milestone — Controlled Shopify product publication ✅ complete (Phase 6 of the customer-facing store)

Closes the pipeline: an approved product can be checked for Shopify
eligibility, built into a deterministic payload, created as a Shopify
DRAFT (never live), and only then explicitly published — a genuinely
separate, confirmation-gated action. Audited first, and the audit did
almost all the design work: `channel_products` (Milestone 1) already had
every column the product↔Shopify mapping needed, and
`channel_products.workflow_state` (Milestone 4) already had a complete
matching state machine (`listingLifecycle.ts`) and append-only history
table, both unused until now. `assessPublicationReadiness` (Milestone 4)
is reused wholesale as the core of the new eligibility gate.

**As built:** `src/lib/marketplaces/shopify/` — `eligibility.ts`
(reused core gate + six new content checks: title, description, images,
selected price, variants, not-a-flagged-duplicate), `payloadBuilder.ts`
(pure, deterministic, a real "Default Title" fallback for products with
no captured variants), `priceOverride.ts` (re-runs the real
profitability engine at the recommended vs. selected price, never a
second formula), and `publicationService.ts` (the orchestrator —
idempotent draft creation via explicit lookup, not a database upsert; a
genuinely separate, re-checked `publishLive`). `MarketplaceConnector`
gained a `createListing` method and `createListings` capability flag
across all six connectors — real GraphQL mutation code in the Shopify
Admin connector, honestly `false` because the app's configured OAuth
scope doesn't include `write_products` (confirmed by inspection, not
assumed), and never touched on the blocked eBay connector beyond the
mechanical stub the interface requires.

**A real idempotency bug caught before shipping:** an early draft used
`.upsert(..., { onConflict })` against `channel_products`, whose unique
constraint includes a nullable `variant_id` — Postgres treats two NULLs
as distinct, so every call would have inserted a second row rather than
updating the first. Fixed with an explicit select-then-insert-or-update
before any test was written against the buggy version.

**Deliberately not built:** Amazon/eBay product creation (Shopify-
specific brief); any automatic publish/pause/archive; per-variant
pricing (no price column exists on `product_variants`); a real image
source for freshly Phase-5-imported products (correctly reported
BLOCKED, not faked — **closed in Phase 7 below**).

## Milestone — Product Media Intelligence & Image Sourcing ✅ complete (Phase 7 of the customer-facing store)

Closes the exact gap Phase 6 left open: a freshly-imported product had
no image source at all, so Shopify eligibility's `images` requirement
was always hardcoded `imageCount: 0`. This milestone gives Commerce OS a
trustworthy, auditable answer to "is this product's media actually
suitable for commercial publication" — never simply "an image URL
exists, so use it." Every image is independently provenance-classified
(supplier/manufacturer/user-provided/unverified — a four-level hierarchy),
quality-checked (resolution/format/size/aspect-ratio against real,
configurable thresholds), watermark/branding-checked (a deterministic,
non-vision URL-pattern check — this codebase has no image-analysis
provider, and none is faked to look more sophisticated than it is), and
product-matched (real evidence — captured together with the product's
own facts, or a textual SKU/title overlap — never a guess), then run
through one deterministic scoring ladder that can only reach 🟢 APPROVED
by clearing every check in order.

**As built:** `src/lib/products/media/` — `qualityCheck.ts`,
`sourceRiskCheck.ts`, `productMatch.ts`, `duplicateDetection.ts`,
`mediaScore.ts` (all pure, fully unit-tested), `imageHeaderParser.ts` (a
hand-written, dependency-free JPEG/PNG/WEBP header parser — no image
library, no fake AI vision), `imageFetch.ts` (`server-only`; SSRF-
mitigated, timeout-bounded, 256KB-capped, content-type-allowlisted
fetch), `assemble.ts` (the capture orchestrator) and `moderation.ts`
(approve/reject/set-primary/remove/refresh), plus `repository.ts` for UI
reads. One new table, `product_media` (managed RLS — org read, owner/
admin write, owner delete), seven new enums, four new
`business_settings` columns. `business_settings.min_product_images`
(Phase 6) is reused unchanged.

**Phase 5 integration:** the candidate capture form gained an optional
image URL, carried through `product_research.raw_signals` and registered
as `supplier_provided` media — with genuine `capturedTogether: true`
evidence — the moment a candidate is imported into a real product.
**Phase 6 integration:** `eligibility.ts`'s `images` requirement and
`createDraft`'s image payload now both read real `product_media` rows
via `assessMediaReadiness`/`getApprovedMediaForPublication` — approved-
only, primary-first, ordered — instead of the old hardcoded `0`/`[]`.

**UI:** a "Product Media" card on `/products/[id]` between Product
Intelligence and Shopify publication — readiness badge, per-image cards
with the brief's own 🟢/🟡/🔴 vocabulary, and Approve/Reject/Set-primary/
Refresh/Review-source/manual-attach controls, owner-gated Remove. A new
"Product media" Settings card for the four quality thresholds.

**Deliberately not built, stated plainly:** no supplier connector
(DSers/Avasam/CJdropshipping/Spocket) is connected or verified — every
connector's `readProductMedia` capability is `false`; media sourcing
works only via a person pasting a URL (Phase 5's capture form, or the
new manual-attach control). No real computer-vision/image-analysis
provider is configured — watermark detection is a genuine, deterministic
URL-pattern check, not vision, and is stated as such in its own output;
AVIF dimensions are an honest, stated gap. No perceptual/near-duplicate
image matching. No automatic publication — media becoming `media_ready`
only ever unblocks one eligibility requirement; a human still presses
"Create Shopify draft" and, separately, "Publish live." (**Closed in
Phase 8 below** — `readProductMedia` is now genuinely `true` for one
real connector.)

## Milestone — Real supplier connector & end-to-end product discovery ✅ complete (Phase 8 of the customer-facing store)

Connects Commerce OS to one real dropshipping supplier's own API rather
than another simulated demo. **CJdropshipping** was selected after
checking each candidate (CJdropshipping, DSers, Spocket, Avasam, Syncee,
EPROLO, AutoDS) against its actual public developer documentation —
the only one with a fully public, self-serve REST API requiring no
partner approval (see `HANDOVER.md` §61 for the full comparison and
every documentation URL consulted). Strictly read/discovery: no order-
placement method exists on the connector interface at all, and none was
added.

**As built:** `src/lib/suppliers/connectors/cjdropshipping.ts` — real
authentication (`apiKey` → 15-day access token / 180-day refresh
token), throttled to the documented 1 req/sec free-tier limit with
retry-on-429, `fetchStatus` (lightweight discovery browse or known-
product refresh) and a new `readProductDetail` method (title,
description, category, real variants, real images, and — only when a
destination is requested — a real destination-aware freight quote via
CJ's own freight-calculation endpoint). Every field is defensively
parsed; a malformed or missing field becomes `null`, never a guess.
`ConnectorCapabilities` gained four flags (`readProductDetails`,
`readVariants`, `readShippingRates`, `readOrders` — the last `false`
everywhere, since no connector may place an order to read back), with
the brief's remaining requested capability names explicitly mapped onto
existing flags rather than duplicated (see `HANDOVER.md` §61).

**New:** `shippingPolicy.ts` (a deterministic APPROVED/REVIEW_REQUIRED/
REJECTED ladder reusing the existing, previously-unwired
`business_settings.max_delivery_days` setting) and `shippingQuotes.ts`
(the orchestrator, persisting every quote to the new
`supplier_shipping_quotes` table — one new table, system-computed RLS,
append-only). Phase 5's candidate capture gained real multi-image and
real `product_variants` creation from connector-sourced data, all
routed through Phase 7's existing `captureAndValidateMedia` unchanged —
no second media pipeline. A "Discover from CJdropshipping" panel on
`/suppliers/discovery` and a capabilities grid on the existing
`/suppliers/connectors` page.

**Tested:** 33 new tests (26 mocked-connector, 7 shipping-policy),
1674 total. `tsc`/`lint`/`build`/`db:verify` (81 tables) all clean.
Browser-verified: the connectors page correctly shows CJdropshipping as
`not configured` with real capabilities on desktop and mobile.

**Not live-verified:** no CJdropshipping account or API key exists in
this environment — every method is proven only by documentation-derived
mocked tests and code inspection, never a real API call.
**Deliberately not built:** any order-placement capability (none
exists on the interface); Phase 6 Shopify eligibility does not yet
consult the new shipping-suitability result (**closed in Phase 9
below**); a simulated `cjdropshippingDemo.ts` connector (the brief's
own "no fake data" instruction, and `/suppliers/discovery` already
hides its entire contents in demo mode, made this both unnecessary and
inadvisable to build for one specific, named, real supplier).

## Milestone — Shipping-aware publication & real CJ verification ✅ complete (Phase 9 of the customer-facing store)

Closes the exact gap the audit found: Phase 8 built
`fetchAndAssessShipping` but nothing called it, and Phase 6's
`assessShopifyEligibility` had no shipping input — a product could
reach a Shopify draft with no shipping suitability check at all.
CJ live verification was genuinely attempted first (checked shell env,
`.env.local`, `.env`) — no `CJ_API_KEY` exists in this environment, so
nothing was fabricated: **IMPLEMENTED, NOT CONFIGURED, NOT
LIVE-VERIFIED**, unchanged from Phase 8's own honest conclusion.

**As built:** `shippingPolicy.ts` gained a freshness rule
(`SHIPPING_QUOTE_MAX_AGE_DAYS = 14`, a code constant per the brief's
"smallest possible mechanism" instruction, not a new setting) — a stale
quote is `review_required` regardless of what it once said.
`shippingQuotes.ts` gained `getShippingSuitability` (reads the most
recent quote batch for a product+destination, re-assessed against the
org's *current* settings and time) and `refreshShippingQuoteForProduct`
(the admin "check/refresh" action, recovering its connector reference
from the product's own `product_research.raw_signals` rather than a new
column). `importCandidate` now calls `fetchAndAssessShipping`
immediately after media capture for connector-sourced imports — the
missing wire. `eligibility.ts` gained a `shipping` requirement,
satisfied only when the status is `approved`; `createDraft`'s existing,
unchanged eligibility check now automatically refuses shipping-blocked
products — no second gate was built.

**A deliberate, disclosed tightening:** every product without a
fetched-and-approved shipping quote — including every product imported
before this feature existed — now blocks on the new requirement until
checked. Stated plainly in `HANDOVER.md` §62 as the brief's own central
requirement, not an oversight.

**UI:** a new "Supplier & shipping" card on `/products/[id]`
(supplier, cost, shipping cost, delivery estimate, destination,
tracking, the decision, and its exact reason, plus a refresh action).
`ShopifyPublicationPanel.tsx` needed no code change — it already
generically renders every eligibility requirement, so `shipping`
appears in its existing checklist automatically. `/suppliers/discovery`
gained a "Delivery" column using data already captured but never shown.

**Tested:** 9 new (5 shipping-policy freshness/destination, 4
eligibility shipping-requirement), 1683 total. `tsc`/`lint`/`build`/
`db:verify` (81 tables, **zero new migrations** — audited first, the
one column needed, `quoted_at`, already existed) all clean.
Browser-verified on desktop and mobile across all four required pages,
zero console errors.

**Not live-verified:** the full CJ → discovery → shipping → eligibility
→ Shopify draft chain has never run against real infrastructure — no
CJ account or live Supabase project exists here; every stage is proven
only in isolation (mocked tests, unit tests, code inspection).
**Deliberately not built:** CJ's `/logistic/unavailableShippingMethods`
endpoint — an explicit supplier "cannot ship here" fact currently
resolves to `review_required`, not a distinguishable `rejected`; the
safe direction of error, but not yet the brief's strongest example.
Phase 4's profitability engine was not touched — it already consumes
the real CJ shipping cost via Phase 8's existing capture flow.

## Milestone — Live infrastructure activation & first real product ⚠️ blocked on missing credentials (Phase 10 of the customer-facing store)

Audited the actual environment before writing anything: no
`NEXT_PUBLIC_SUPABASE_URL`/`_ANON_KEY` and no `COMMERCE_OS_MODE=live`
exist, so `isDemoMode()` returns `true` unconditionally — every session
in this codebase is demo mode regardless of any other credential. No
`CJ_API_KEY` exists either. Real Shopify Admin credentials
(`SHOPIFY_STORE_DOMAIN`/`CLIENT_ID`/`CLIENT_SECRET`/`API_VERSION`) do
exist, and were the one thing this milestone could genuinely,
live-verify.

**Live-verified (real, read-only, against the account holder's real
store):** OAuth authentication, store identity read, product read, and
— the specific fact the brief asked to confirm — the actual granted
OAuth scope: `read_fulfillments,read_inventory,read_orders,read_products`,
**no `write_products`**. This confirms, live, what the existing
`createListings: false` declaration already assumed by inspection.

**As built:** `shopify.ts`'s `getAccessToken` now captures and returns
the real `scope` field from Shopify's own token response (previously
discarded); `ConnectionHealth` (shared across all marketplace
connectors) gained `grantedScope: string | null`, wired for real in
Shopify and eBay (which already computed but never surfaced
`oauthScopesGranted`), `null` for Amazon and the demo connectors. Not a
secret — an OAuth permission grant.

**Not attempted, honestly:** any real CJ call (no key), any live
Supabase read or write (no connection), the first real product test
(§§7-27 of the brief) — none of it can run without a real Supabase
project, regardless of CJ or Shopify credentials. Nothing was
simulated or mocked and presented as a live result.

**Tested:** 3 new (Shopify's scope capture, null-scope handling, and
end-to-end scope threading through a successful call), 1686 total.
`tsc`/`lint`/`build`/`db:verify` (81 tables, zero migrations) all
clean. Browser-verified, desktop and mobile, zero console errors, on
every page this milestone's brief names. Secret scan clean, including
the real Shopify credential values themselves, confirmed absent from
the tracked diff. `informax-site` unaffected.

**Genuine remaining blockers, none fixable from within this
repository:** (1) a live Supabase project plus `COMMERCE_OS_MODE=live`;
(2) a real `CJ_API_KEY`; (3) even with both, the connected Shopify
app's own OAuth scope has no `write_products` — a real Shopify draft
cannot be created until that scope is added in the Shopify Partner
Dashboard and the merchant re-consents, a configuration action outside
this codebase entirely.

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
