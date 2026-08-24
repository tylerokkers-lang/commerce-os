# Architecture

## The shape of the thing

Shopify and Amazon are sales channels. Neither is the system. The system is a
central application that owns the products, suppliers, stock, orders, money and
decisions, and pushes to or pulls from each channel independently.

```
                         COMMERCE OS
                              |
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   PRODUCT AI            FINANCE AI           COMPLIANCE AI
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              │
                      CENTRAL DATABASE  ← source of truth
                              │
                ┌─────────────┴─────────────┐
                │                           │
             SHOPIFY                    AMAZON UK
                │                           │
                └─────────────┬─────────────┘
                              │
                       ORDER ENGINE
                              │
                   SUPPLIER / FULFILMENT
                              │
                          CUSTOMER
```

The consequence that matters most: **a product has an independent status on
every channel**. Live on Shopify and blocked on Amazon is a normal state, not an
error, and the interface never collapses the two into one status.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | Server Components keep credentials and business logic server-side by default |
| Language | TypeScript, strict | Money and compliance rules are not places for `any` |
| Database | Supabase Postgres | Relational integrity, row level security, and auth in one place |
| Auth | Supabase Auth | Sessions refreshed in `proxy.ts` |
| Storage | Supabase Storage | Invoices, compliance documents, brand assets |
| Styling | Tailwind CSS v4 | CSS-first tokens in `globals.css` |
| Tests | Vitest | Fast enough to run on every change |
| Schema checks | PGlite | Runs the real migrations against a real Postgres engine in memory |

Note this is Next.js **16**: `middleware.ts` is deprecated in favour of
`proxy.ts`, and `cookies()`, `headers()`, `params` and `searchParams` are all
async. Read `node_modules/next/dist/docs/` before writing framework code.

## Module layout

```
src/lib/
  core/          money, Result, env, domain view models
  supabase/      generated types and the three clients
  security/      session, roles, action guards
  audit/         append-only action log
  profitability/ the cost model everything else defers to
  demo/          the simulated business
  products/      catalogue, lifecycle, identifiers
  suppliers/     supplier scoring, redundancy, connectors
  compliance/    per-channel gate reads
  marketplaces/  connectors (Shopify/Amazon), reconciliation, publication gate
  orders/        ingestion, validation, refunds, the order pipeline
  fulfilment/    lifecycle, selection, submission, tracking
  inventory/     stock reservation
  automation/    policy engine, job queue, live facts, execution pipelines,
                 approvals — see below
  monitoring/    monitors, domain events, the scheduler runner — see below
  fx/            exchange rate facts, provenance, currency conversion — see below
  markets/       country/currency/marketplace model, country-aware
                 compliance, market profitability, expansion engine — see below
  notifications/ read + write (write added Milestone 6)
  integrations/  connection health
  tax/           VAT and finance reads
  analytics/     business intelligence — sales, profit, product, channel,
                 supplier, fulfilment, advertising-architecture, data
                 quality, business health, plus the Milestone 1 reporting
                 reads `/report` still uses — see below
  amazon/ shopify/ pricing/ invoices/ accounting/ research/ ai/
```

The empty directories are deliberate: they are the seams later milestones
fill, and having them named now stops integration code from being written into
whatever file happens to be open.

### `src/lib/automation/` (Milestones 6–7)

The busiest module, so its own map:

```
types.ts, settingsTypes.ts, factsTypes.ts, store.ts   pure interfaces/types
policyEngine.ts, supplierSwitching.ts, priceAutomation.ts,
inventoryAutomation.ts, publicationAutomation.ts,
orderAutomation.ts, monitoring.ts                      pure decision engines
priceExecution.ts, supplierSwitchExecution.ts          SUBMIT->VERIFY->RECONCILE pipelines
handlers/*.ts                                          the 14 job handlers (thin orchestration)
worker.ts                                              claim -> dispatch -> complete
jobs.ts, actions.ts, settings.ts, facts.ts,
proposeApproval.ts, supabaseStore.ts                   Supabase-backed implementations
inMemoryStore.ts, inMemoryFactsLoader.ts               real (not mocked) test doubles
approvalWorkflow.ts, killSwitch.ts                     the approval and kill-switch APIs
```

Two interfaces are satisfied twice each, on purpose: `AutomationStore`
(`store.ts`) by `supabaseStore.ts` (production) and `inMemoryStore.ts`
(tests), and `FactsLoader` (`factsTypes.ts`) by `facts.ts` (production) and
`inMemoryFactsLoader.ts` (tests) — `FactsLoader` gained a fourth method in
Milestone 8.5, `loadSupplierOperationalFacts` (dispatch/delivery/
cancellation/feed-health facts), satisfied identically in both places. This is what lets
`tests/automation-engine-e2e.test.ts`, `tests/automation-job-handlers.test.ts`
and `tests/automation-execution-e2e.test.ts` drive the *real* orchestration
code (`runWorkerBatch`, `executePriceChange`, `executeSupplierSwitch`) end
to end without a live Supabase project — the standard way to test code that
would otherwise require a live external service, and the reason two real
bugs were found by tests rather than by inspection (see `HANDOVER.md` §18–19).

### `src/lib/monitoring/` (Milestone 8, subject discovery completed in 8.5)

Sits strictly upstream of `automation/`: monitors observe and raise domain
events; they never decide or act. Enforced structurally, not just by
convention — no monitor imports a marketplace connector's write methods or
`priceExecution.ts`/`supplierSwitchExecution.ts`.

```
eventTypes.ts             pure interfaces/types (EventStore, Monitor, MonitorContext)
eventStore.ts, inMemoryEventStore.ts   Supabase-backed and in-memory EventStore
monitors/*.ts              the 8 monitors (supplier stock/price, supplier
                           operations, marketplace, compliance,
                           profitability, sales performance, fx rates,
                           market expansion), each composing an existing
                           engine, never duplicating one
registry.ts                closed MONITORS map + explicit EVENT_TO_JOB_MAPPING
runner.ts                  runDueMonitors: schedule check -> subject discovery
                           -> monitor run -> events -> jobs; SubjectProvider
                           returns { subjects, errors } so one discovery
                           source failing yields partial_success, not a
                           false success or lost coverage (Milestone 8.5)
liveSubjects.ts             real, paginated, org-scoped "which subjects to
                           check" queries for all 6 monitors (Milestone 8.5)
repository.ts               the /automation page's business-intelligence data,
                           including supplier/product/marketplace
                           intelligence drill-downs (Milestone 8.5)
```

`src/lib/orders/salesAggregation.ts` is `monitoring/`'s sibling for real
sales data: pure aggregation (`aggregateSalesWindow`, `computeWindowBounds`)
over `orders`/`order_items`/`refunds` rows, kept DB-free and fully unit
tested — `liveSubjects.ts` is the one server-only caller that queries the
real tables and feeds it.

The same "define the interface, satisfy it twice" pattern as `automation/`:
`EventStore` (`eventTypes.ts`) is satisfied by `eventStore.ts` (production)
and `inMemoryEventStore.ts` (tests). The flagship
`tests/monitoring-integration-e2e.test.ts` drives `runDueMonitors` directly
into `automation/worker.ts`'s `runWorkerBatch` against the same shared
in-memory stores — the full monitor -> event -> job -> worker -> facts ->
policy -> action -> audit chain, through real entry points only.

Deduplication is a database guarantee, not an application convention: a
partial unique index on `domain_events(org_id, dedupe_key)` where
`status = 'open'` is what actually prevents a supplier outage checked every
15 minutes for 6 hours from becoming 24 separate events — see
`docs/DATABASE.md`.

### `src/lib/fx/` and `src/lib/markets/` (Milestone 9)

`fx/` treats exchange rates as facts with provenance, never bare numbers:

```
types.ts      ExchangeRateFact, fresh/stale/unknown/unavailable freshness,
              per-use-case staleness windows (automation/product-evaluation/
              order-fulfilment/strategic-expansion)
convert.ts    convertMoney(original, targetCurrency, rate, freshness) ->
              Result<ConversionResult, FxConversionError> — rejects
              same-currency no-ops and mismatched currency pairs explicitly
inMemoryFxStore.ts, fxStore.ts   FxRateStore satisfied twice (tests, and
              server-only Supabase production)
demoRates.ts  deterministic seed rates — an explicit demo seed, not a live
              feed; no FX provider exists yet
```

`markets/` composes with the existing UK-only channel/compliance/
profitability code rather than reworking it — it never introduces a second
profitability calculator or a global "compliant" boolean:

```
types.ts, catalog.ts        MARKET_CATALOG: a closed, pure-TypeScript
                             registry of country/marketplace combinations.
                             resolveMarketStatus derives each entry's real
                             LIVE/DEMO/PLANNED/NOT_CONFIGURED status from
                             the connector registry at read time (never
                             stored), reusing deriveMarketplaceStatus
                             (Milestone 4)
countryCompliance.ts        assessMarketCompliance delegates to the real
                             assessCompliance engine for GB; every other
                             country returns an honest not_assessed with a
                             stated missing-fact reason — no invented
                             ruleset
marketCostProfiles.ts       seed fee/fulfilment/tax assumptions per market,
                             each documented as a seed, not a live lookup
marketProfitability.ts      resolveMarketProjectionInput does FX
                             normalisation *before* projectMarketProfitability
                             calls the one existing profitability engine —
                             this is what lets an FX movement flip a
                             market's native pass/fail, not just a
                             comparison figure
expansion.ts                evaluateMarketExpansion: a deterministic engine
                             where fatal checks (compliance fail, supplier
                             cannot ship, profitability fails outright) are
                             checked and can block *before* the transparent,
                             renormalised score is ever consulted — a high
                             score can never override a compliance failure
supplierMarketFacts.ts,
supplierMarketFactsStore.ts SupplierMarketFactsLoader satisfied twice:
                             can-ship / shipping cost & currency / delivery
                             window / cancellation rate, per supplier per
                             destination country
repository.ts,
inMemoryMarketRepository.ts,
supabaseMarketRepository.ts MarketExpansionRepository satisfied twice —
                             append-only persistence, each row storing the
                             exact job payload that produced it so a
                             chained FX recheck can replay it verbatim
```

`market_key` (plain text, e.g. `amazon_de`) is a new, orthogonal, code-only
catalog concept — it is **not** `channel_key` (the existing
`shopify`/`amazon_uk` enum the business actually operates on), and links
back to a real channel only when one exists (`MarketDescriptor.channelKey`).
`fxMonitor`/`marketMonitor` (`monitoring/monitors/`) and
`handleMarketRecheck`/`handleFxRecheck` (`automation/handlers/
marketHandlers.ts`) wire both modules into the existing monitoring and
automation pipelines described above — no parallel automation system was
built, and only a `ready` expansion recommendation ever creates a
`request_approval` action.

### `src/lib/analytics/` (Milestone 10)

Every figure is wrapped in a `Metric<T>`/`PeriodMetric<T>` (`types.ts`)
carrying one of seven fact-status labels
(`fact`/`calculated`/`derived`/`estimate`/`unknown`/`stale`/`unavailable`),
never a bare number — a missing cost is `unknown`, not zero.

```
types.ts               FactStatus vocabulary, Metric<T>/PeriodMetric<T>
salesAnalytics.ts       wraps orders/salesAggregation.ts's
                        aggregateSalesWindow (called twice — the
                        requested period and previousEquivalentPeriod's
                        bounds — never a second aggregation engine)
profitAnalytics.ts      wraps profitability/channels.ts's
                        buildChannelProfiles/projectChannel (the one
                        profitability engine); rejects a supplier cost
                        quoted in a different currency than the channel's
                        listing price rather than combining them
productAnalytics.ts     classifyProduct: deterministic tags
                        (top_revenue/high_margin/loss_making/
                        declining_sales/supplier_risk/...) from real
                        ranks, margins and open-event flags — never an
                        invented score
channelAnalytics.ts     per-channel sales + a known-profit rollup that
                        states how many products were excluded, and why
supplierAnalytics.ts    HEALTHY/WATCH/AT_RISK/UNAVAILABLE/UNKNOWN from
                        real dispatch/cancellation/fulfilment-success
                        facts, always with a stated reason
fulfilmentAnalytics.ts  dispatch time, on-time delivery, cancellation
                        rate, missing tracking — a shipped-but-
                        unconfirmed delivery is unknown, never assumed
advertisingAnalytics.ts the interface a future ad-platform connector
                        will satisfy; every figure is unavailable today
                        because no connector exists — never a
                        fabricated £0 spend
dataQuality.ts,
businessHealth.ts       roll every other module's unknown/stale/
                        unavailable counts into a CEO-legible issue
                        list, and a deterministic, evidence-carrying
                        alert feed (revenue decline, profit decline,
                        profit decline despite revenue growth, supplier
                        at-risk, data-quality gaps)
liveAnalyticsFacts.ts   server-only; the one org-scoped, paginated
                        Supabase caller everything above is fed from,
                        via the shared supabase/paginate.ts helper
repository.ts           EXTENDS the Milestone 1 reporting reads /report
                        still uses (untouched) — getAnalyticsDashboard()
                        is the one round trip /automation makes; the
                        named getBusinessOverview/getRevenueAnalytics/
                        getProfitAnalytics/getProductAnalytics/
                        getSupplierAnalytics/getMarketplaceAnalytics/
                        getMarketAnalytics/getDataQuality functions are
                        the entry points a future CEO AI assistant
                        (Milestone 12) queries facts through
```

`core/compare.ts`'s `comparePeriods` (promoted out of
`monitoring/monitors/performanceMonitor.ts`'s previously-private
`pctChange`) is the one place "current vs previous, absolute diff,
percentage diff, direction" is computed, shared by every monitor and every
analytics module — `previous === 0` yields `percentChange: null` (not
`Infinity`), unless `current` is also `0`, which is a real, flat `0%`.

`profitabilityMonitor.ts` (Milestone 8, extended here) now computes a real
channel-aware margin via the same engine when its subject carries the
optional `channel`/`connectorKey` fields, emitting
`PRODUCT_MARGIN_DROPPED`/`RECOVERED` and
`PRODUCT_NO_LONGER_PROFITABLE`/`BECAME_PROFITABLE` — three event types
that had been reserved in `EVENT_TO_JOB_MAPPING` since Milestone 8 but
never actually emitted. A frozen reference margin is kept while a product
is in a dropped state, so a margin that merely stops falling is never
misreported as recovered.

## Rules the code follows

**Money is integer minor units.** Every monetary column ends in `_minor` and
holds pence. `src/lib/core/money.ts` is the only place arithmetic happens.
Floating point is never used for money: `0.1 + 0.2 !== 0.3` is a curiosity in
most software and a mis-stated VAT return here.

**Nothing is profitable because it sold.** `calculateProfitability` strips VAT
first, then subtracts product cost, inbound shipping, fulfilment, packaging,
channel fees, payment fees, a weighted returns allowance, a refunds allowance
and advertising. `assessProfitabilityGate` returns reasons, not a boolean, so a
blocked product can always explain itself.

**Demo mode is a first-class mode, and it is the default.** With no environment
variables the system runs a complete simulated business through the real
profitability engine. Live mode requires Supabase to be configured *and*
`COMMERCE_OS_MODE=live` to be set explicitly. Nothing can reach a real
marketplace by accident.

**Empty is not the same as unknown.** A live business with no orders shows
zeros, not demo figures. Aggregates that are not yet implemented return honest
empties rather than plausible numbers.

**Every consequential action is audited.** `audit_logs` is append-only at the
database level; UPDATE and DELETE raise an exception. `recordAudit` never
throws, so a logging failure cannot roll back a business action that succeeded,
but it does report to stderr.

**Server Actions guard themselves.** They are reachable by direct POST, not only
through the UI, so each one calls `requireWriteAccess()` rather than trusting
that a page rendered.

**Secrets never reach the browser.** Server-only modules import `server-only`.
The service role key bypasses RLS and is used solely by trusted server-side
automation.

## Data access

Every read goes through a repository that branches on `session.isDemo` and
returns the same view model either way, so no component knows which mode it is
in. The view models live in `src/lib/core/domain.ts`.

```
page.tsx  →  lib/<domain>/repository.ts  →  demo dataset  or  Supabase
```

## Generated types

`src/lib/supabase/database.types.ts` is generated from the migrations
themselves: they are applied to PGlite and the catalogue is introspected,
including foreign keys so nested selects type correctly. Run `npm run db:types`
after any migration change. Once a real Supabase project exists,
`supabase gen types typescript` against it is equivalent.
