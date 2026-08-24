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
- No CEO Dashboard exists yet (Milestone 10) for the brief's §20 to extend —
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
  remains Milestone 10) — this extends the same `/automation` page
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
  `orders`/`order_items`/`refunds` rows; Milestone 9 should extend this
  module rather than build a second one.
- ~~Supplier delivery/dispatch/cancellation-rate/connector-health
  monitoring... is not built~~ — **resolved** for dispatch, delivery,
  cancellation rate, fulfilment reliability and feed staleness (a new
  `supplierOperationsMonitor`); still not built: supplier feed health
  differentiated per-connector-type beyond `supplier_connectors`' own
  status field (a finer distinction than this pass needed).
- No dedicated CEO Dashboard route — **still not built**; the
  business-intelligence section (now including supplier/product/marketplace
  intelligence drill-downs) extends `/automation` per this milestone's
  brief; Milestone 10 remains the dedicated dashboard.

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

## Milestone 9 — Analytics and business intelligence

Revenue, orders, units, gross profit, contribution, contribution margin, ad
spend, CAC, ROAS, MER, refunds, returns, supplier/delivery/marketplace/product
performance, and cash movement, each clearly and separately defined — revenue,
cash received, gross profit, contribution and accounting profit are never used
interchangeably. Standard comparison periods (today, yesterday, this/last
week, month to date, previous month, custom range), and every comparison
states its comparison period explicitly.

## Milestone 10 — CEO dashboard

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

## Milestone 11 — Commerce Intelligence chat

An AI chat interface answering real questions about the actual business
through a controlled tool/query layer with explicit per-tool permissions —
never raw, unrestricted database access. Responses follow the fact-first
categories (facts, calculations, rules, analysis, predictions, uncertainty)
and the system can say "I don't have enough current data to answer that
reliably." Credentials never enter conversational memory.

## Milestone 12 — AI actions

Four interaction modes — ask, analyse, recommend, execute — where "execute"
still passes through the same automation-level and approval machinery as any
other action. The AI is never the source of authority: rules, permissions,
validation and the action layer built in Milestones 5–6 remain authoritative
regardless of what the AI recommends.

## Milestone 13 — Advertising intelligence

Advertising platform integrations (Amazon Ads, Meta, Google, TikTok as
applicable) evaluated on contribution after advertising, never on ROAS alone —
a campaign can carry high revenue or a strong ROAS and still be unprofitable
once real costs are included. Automated advertising actions carry account,
daily and per-product limits, maximum percentage changes, approval thresholds,
cooldowns, rollback logic and audit logging, with no path to unlimited
automated spend.

## Milestone 14 — International expansion

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
