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

## Milestone 4 — Marketplace connector foundation

Build the connector architecture before implementing every live marketplace.
A common interface covers connection health, authentication status,
product/listing sync, inventory sync, orders, fulfilment updates, returns
where supported, fees, marketplace-specific compliance, webhooks, and
scheduled reconciliation. Build Shopify first (modern Admin API), then Amazon
UK (official Selling Partner API). Secrets live in environment variables only.
Demo connectors are clearly marked as demo; live mode requires explicit
configuration, exactly as `COMMERCE_OS_MODE=live` already requires it for the
rest of the system.

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
