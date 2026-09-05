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
  products/      catalogue, lifecycle, identifiers, opportunity scoring,
                 decisions; intelligence/ (quality/risk/capital/pricing/
                 recommendation engines + the assembler that persists
                 them — see below); media/ (provenance, quality,
                 watermark/branding, product-match and duplicate checks,
                 the deterministic media score, the capture/moderation
                 orchestrators — see below)
  suppliers/     supplier scoring, redundancy, connectors/ (manual, and
                 the real CJdropshipping connector — Phase 8);
                 shippingPolicy.ts (deterministic shipping suitability +
                 freshness, Phase 8/9) + shippingQuotes.ts (fetch,
                 persist, and read back for the Shopify eligibility gate
                 — Phase 8/9); discovery/ (candidate capture, duplicate
                 detection, offer comparison, import — hands off to
                 products/intelligence/ unchanged, never a second scoring
                 engine — see below)
  compliance/    per-channel gate reads
  marketplaces/  connectors (Shopify/Amazon/eBay — `ConnectionHealth`'s
                 `grantedScope` is a live-checkable OAuth scope fact
                 since Phase 10, not an assumption), reconciliation,
                 publication gate, listing lifecycle; shopify/
                 (eligibility — now shipping-aware, Phase 9 — payload
                 builder, price override, the controlled publication
                 orchestrator — reuses the gate above, never a second
                 one)
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
  ceo/           the CEO Command Centre composition layer — priority
                 queue, business health scorecard — see below
  ai/            the Commerce Intelligence chat — fact bundling, prompt
                 construction, guardrails, the model provider — see below
  shopify/       the Storefront API connector for the headless storefront
                 (`storefront.ts`) — deliberately separate from
                 `marketplaces/connectors/shopify.ts`'s Admin API
                 connector: different credential, different API surface,
                 structurally unable to read orders/customers or write
                 products
  amazon/ pricing/ invoices/ accounting/ research/
```

The remaining empty directories are deliberate: they are the seams later
milestones fill, and having them named now stops integration code from
being written into whatever file happens to be open.

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
advertisingAnalytics.ts (Milestone 14) the deterministic advertising
                        classification engine — see the dedicated
                        paragraph below the code block; still no ad-
                        platform connector exists, so every figure is
                        genuinely unavailable until real spend/revenue
                        rows exist in the advertising table
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

**Milestone 14 extends `advertisingAnalytics.ts`** from an empty interface
into a real, deterministic engine over the `advertising` table (created in
Milestone 1, never written to until now): `buildCampaignFact` (per-campaign
`Metric<T>` figures — spend, revenue, ROAS, ACOS, CTR, CPC, CPA, average
order value, conversion rate), `resolveCampaignProfitability` (ties a
campaign to the one real profitability engine's `breakEvenAdSpend`, never a
second calculation), `classifyCampaign` (the seven-way classification —
`wasted_spend`/`poor_profitability`/`high_acos_low_roas`/
`scale_opportunity`/`declining_performance`/`healthy`/`insufficient_data`,
each gated by a named threshold or a minimum-sample-size check, never an
LLM call — every boundary is `>=`/`<` exactly as documented and tested,
e.g. ROAS exactly at the configured minimum is healthy-eligible, spend
exactly at the waste threshold is waste), and `buildAdvertisingScorecard`
(org-wide roll-up including `overallCpa`/`overallAverageOrderValue`, worst
campaign wins, the same rule `healthScorecard.ts` already established).
`liveAdvertisingFacts.ts` (server-only) is the one org-scoped Supabase
reader, following the same `paginate.ts` pattern as every other Milestone
10 live loader. `analytics/repository.ts`'s `getAdvertisingIntelligence()`
composes the two — genuinely empty in demo mode (never injecting fixture
data into the live path), with `demo/advertising.ts`'s seven narrative
scenarios computed through the real functions above against fixed fixture
data instead. `getAnalyticsDashboard()` (same file) also calls
`buildRealAdvertisingAnalytics(scorecard)` to populate the pre-existing
`AnalyticsDashboard.advertising` field (Milestone 10's org-wide summary
shape, consumed by `/automation`) with this same real data — additive to
an existing field, reusing the same `loadAdvertisingFacts` read and the
same per-product profitability projections that function already loads,
never a second query or a second, disconnected advertising model. Wired
into `ceo/repository.ts`'s existing `Promise.allSettled`
(a seventh source, `advertisingIntelligence`, with its own
`dataSourceFailures` entry), `ceo/priorities.ts` (a seventh priority
section, including the compliance-block override that prevents a
non-compliant product's campaign from ever appearing as an unrestricted
scaling recommendation), and `ceo/healthScorecard.ts` (a ninth health
area). `src/app/(dashboard)/advertising/page.tsx` presents this — scorecard,
priorities, per-campaign detail, demo scenarios — and deliberately has no
pause/budget-change control anywhere on it (see `docs/SECURITY.md`'s
Milestone 14 section for why).

### `src/lib/advertising/` (Milestone 15 — see `HANDOVER.md` §31 for the numbering note)

The live connector + sync layer underneath Milestone 14's intelligence,
which never itself changes:

```
connectors/types.ts    AdvertisingProvider — deliberately mirrors
                       marketplaces/connectors/types.ts: same descriptor/
                       capabilities/Result<T,E> shape, same env-var-name-
                       only credential declaration. NormalizedCampaignFact
                       (Phase 3) is the one shape every platform's API
                       response gets translated into — the intelligence
                       engine never sees a provider-specific field
connectors/registry.ts  All four platforms registered: amazonAdsConnector
                       (real LWA OAuth exchange + real synchronous pause/
                       budget writes; fetchCampaigns honestly declines —
                       see its own module comment), demoAdvertisingConnector
                       (real SUBMIT->VERIFY via an in-memory Map, the
                       demo/test-double pair), and UnavailableAdvertisingConnector
                       stubs for meta_ads/google_ads/tiktok_ads — the same
                       pattern suppliers/connectors/registry.ts's six
                       planned connectors already established
validation.ts           Phase 5. Pure. Re-checks every field of a fetched
                       fact at runtime regardless of its compile-time
                       type — a connector's response came from an unsafe
                       `as T` cast of untrusted JSON, the same risk every
                       connector in this codebase already carries. A
                       record that fails is quarantined, never written
syncPlan.ts             Phase 4's pure decision logic — what to upsert,
                       what to quarantine, whether the whole sync is
                       blocked (no sales channel configured for this
                       platform connection — a real modelling gap between
                       `channel_key` and "which ad platform," see
                       docs/SECURITY.md — is a safety gate, never a guess)
sync.ts                 server-only. The thin writer: fetch -> validate ->
                       plan -> upsert into the pre-existing `advertising`
                       table (composite-key upsert, idempotent) -> record
                       connection state (`advertising_connections`) and
                       audit trail. Never called directly from worker.ts
                       or any handler — see the note below
repository.ts           server-only. getAdvertisingConnectorSummaries():
                       session-scoped (not service-role) read of
                       advertising_connections for /advertising's
                       Connections card — a plain read, the same client
                       /marketplaces/settings already use for their own
                       tables
```

`automation/advertisingAutomation.ts` (domain policy, mirrors
`priceAutomation.ts`'s split) and `automation/advertisingExecution.ts`
(`proposeCampaignAction`/`submitCampaignAction`, mirrors
`priceExecution.ts`'s SUBMIT->VERIFY->RECONCILE) live in `automation/`,
not `advertising/`, matching where `priceAutomation.ts`/`priceExecution.ts`
already live relative to `analytics/`. `assessCampaignActionPolicy` has no
code path that can produce `domainOutcome: 'auto_permitted'`, for any
input — the brief's "no unrestricted automatic campaign changes"
requirement enforced as an absent branch, not a runtime flag.

**A structural rule worth stating explicitly, because it was violated
once and caught by the test suite**: `automation/worker.ts` (and every
file it imports, including every `automation/handlers/*.ts`) must import
zero `server-only` modules, so it stays importable into Vitest — the same
reason `FactsLoader`/`ConnectorLookup` are injected interfaces there
rather than direct imports of `facts.ts`/the connector registries.
`advertising/sync.ts` is `server-only`; `automation/handlers/advertisingHandlers.ts`
never imports it — it receives `runSync` as an injected
`AdvertisingHandlerDeps` dependency, constructed only inside
`/api/automation/run/route.ts` (a Route Handler, which is allowed to
import server-only modules directly, same as every other Route Handler in
this codebase).

### `src/lib/ceo/` (Milestone 11)

The CEO Command Centre — a presentation/composition layer, deliberately
kept out of `analytics/` per the brief's own layering:
`Operational systems -> Authoritative engines -> Analytics & BI (M10) ->
CEO Command Centre (M11) -> CEO`. Nothing here recalculates a metric
Milestone 6–10 already computed.

```
types.ts             Priority, HealthArea/HealthStatus, CEOCommandCentre,
                      CEODemoScenario
priorities.ts         buildPriorities: the one executive priority queue.
                      Maps analytics.alerts (Milestone 10) straight
                      through — never re-derived — and adds only what
                      Milestone 10 did not already alert on: channel-
                      specific loss-making products, automation health,
                      pending approvals (severity escalates only on a
                      real expiry-proximity fact), compliance rechecks,
                      fulfilment problems. Sorted critical-first, then
                      most-recent-first
healthScorecard.ts    buildBusinessHealthScorecard: 8 deterministic areas
                      (financial/product/supplier/marketplace/
                      fulfilment/compliance/automation/data quality),
                      each HEALTHY/WATCH/AT_RISK/CRITICAL/UNKNOWN with a
                      stated reason, built entirely from existing counts
                      and classifications. Overall status is always the
                      single worst area — never a separately invented
                      blended score
repository.ts         server-only; getCEOCommandCentre() composes
                      getAnalyticsDashboard/getMonitoringStatus/
                      getAutomationStatus/getPendingApprovals via
                      Promise.allSettled — never a bare Promise.all — so
                      one source failing falls back to a safe empty
                      value (recorded in dataSourceFailures) rather than
                      crashing the whole page; the first use of this
                      fallback pattern in this codebase, added because
                      this milestone's brief explicitly required it
```

`src/components/dashboard/MetricStat.tsx` (extracted from `/automation`'s
page) is the one place a `Metric<T>`/`PeriodMetric<T>` renders — a value
plus a comparison badge when known, an honest UNKNOWN/STALE/UNAVAILABLE
badge plus its source when not — shared by `/automation` and `/` so
neither can drift from the other's rendering rules.

### `src/lib/ai/` (Milestone 12; extended Milestone 13, 14)

The Commerce Intelligence chat — an interface over the existing
intelligence layer, never a second one:
`Operational systems -> Authoritative engines -> Analytics & BI (M10) ->
CEO Command Centre (M11) -> Commerce Intelligence chat (M12/13/14) -> CEO`.
Every fact the chat can see is read straight off `getCEOCommandCentre()`
(Milestone 11) plus the adjacent repositories the CEO dashboard page
already calls directly (`getOpportunities`/`getIntelligenceSummary`,
`getSuppliers`, and — new in Milestone 13 — `getProducts` for catalogue
titles/SKUs) — nothing here recomputes a priority, a health status, a
compliance verdict, or a profit figure. `ceo.advertisingIntelligence`
(Milestone 14) is already composed into `CEOCommandCentre` — the chat
never issues a second advertising query. Milestone 12 (Phase 1, Analyse)
is strictly read-only. Milestone 13 adds Phase 2 (Recommend) and Phase 3
(Propose), both still read-only in themselves — see `ai/actions/` below
for the one narrow path that can create real (pending-approval) state.
Milestone 14 extends both phases to advertising campaigns without adding
a second pipeline.

```
types.ts              ChatMessage, FactBundle, ChatAnswer, ChatReference,
                       and the ChatProvider interface every model
                       implementation satisfies — the same "define the
                       interface, satisfy it twice" shape as
                       AutomationStore/FxRateStore/EventStore elsewhere
factBundle.ts          buildFactBundle: the one place a turn's facts are
                       assembled, pure and directly tested. A metric this
                       codebase already marked unknown/stale/unavailable
                       (Milestone 10's isKnown) is never coerced into a
                       number here — it becomes an explicit caution
                       string instead. serializeFactBundle/
                       deriveReferences turn a bundle into the model's
                       text context and the UI's reference chips —
                       chips are derived from the bundle in code, never
                       parsed out of the model's own reply, so a
                       hallucinated entity simply has no chip
guardrails.ts           Request validation (zod) and the textual half of
                       prompt-injection defence — see docs/SECURITY.md's
                       Milestone 12 section for the full threat model;
                       the structural half (no tool access) lives in
                       anthropicRequest.ts
promptBuilder.ts        The fixed system prompt (fact-first rules, never
                       re-derived per turn) plus per-turn message capping
offlineAnswer.ts        The deterministic, no-network fallback used
                       whenever ANTHROPIC_API_KEY is not configured
                       (core/env.ts's isConfigured('anthropic')) and in
                       every test — not a miniature language model, only
                       orders and labels the same real facts a live
                       model would have received
offlineProvider.ts,
anthropicRequest.ts,
anthropicProvider.ts   ChatProvider satisfied twice. anthropicRequest.ts
                       is deliberately pure (unlike anthropicProvider.ts,
                       which is server-only and holds the real SDK
                       client) so the request it builds — which never
                       includes a tools field anywhere in this codebase —
                       is directly unit tested
repository.ts          server-only; askCommerceIntelligence() composes
                       getCEOCommandCentre/getOpportunities/
                       getIntelligenceSummary/getSuppliers/getProducts
                       via Promise.allSettled, the same fail-safe pattern
                       Milestone 11 introduced, and falls back to the
                       offline answer if the live model itself fails —
                       a model outage degrades the answer, never the
                       whole route. Also builds Milestone 13's
                       recommendations (deterministic, from the bundle)
                       and, when the user's own message names a real
                       product and a recognised action, a proposedAction
                       preview — entirely independent of which provider
                       answered content
```

`src/lib/ai/actions/` (Milestone 13 — Analyse, Recommend, Propose; extended Milestone 14 for campaigns):

```
types.ts               The finite ProposedActionType vocabulary (12
                       members as of Milestone 14 — 8 product-targeting
                       plus 4 campaign-targeting: REVIEW_CAMPAIGN/
                       PAUSE_CAMPAIGN/INCREASE_BUDGET/DECREASE_BUDGET,
                       see CAMPAIGN_ACTION_TYPES) and the
                       Recommendation/ProposedAction shapes. Module
                       comment explains the central design choice: the
                       model is never asked to emit structured JSON for a
                       proposal at all — there is nothing for guardrails
                       to parse-and-distrust, because nothing AI-authored
                       is ever parsed in the first place. A proposal's
                       every field is either a fixed vocabulary member or
                       resolved fresh against real data. RawActionIntent
                       is polymorphic — exactly one of a
                       product-match-pair or a campaign-match-pair is
                       ever populated, decided by whether actionType is
                       in CAMPAIGN_ACTION_TYPES
intentExtraction.ts     Pure. Reads only the user's own latest message —
                       never a model reply — and matches it against the
                       FactBundle's real, already-known products or (new
                       in Milestone 14) advertising campaigns only.
                       Ambiguous or unmatched input produces null, never
                       a guess; this is the entire technical answer to
                       "the AI proposal is untrusted input" for the
                       identification step. Campaign-specific keyword
                       patterns (budget/pause/review-campaign) are
                       checked before their generic product-vocabulary
                       counterparts so "pause this campaign" never
                       resolves to the unrelated PAUSE_LISTING
recommend.ts            Pure. buildRecommendations: the same kind of
                       deterministic rule set ceo/priorities.ts's
                       buildPriorities already is, applied to "what's
                       worth suggesting." Loss-making known products ->
                       an UPDATE_PRICE recommendation; active compliance
                       fail/review_required -> a REVIEW_PRODUCT
                       recommendation pointing at /compliance, never
                       marked executable; low-scoring/blocked suppliers
                       -> REVIEW_SUPPLIER; (Milestone 14) a non-healthy
                       campaign -> a REVIEW_CAMPAIGN recommendation —
                       scale_opportunity is deliberately excluded here,
                       because the FactBundle's campaign shape carries no
                       productId to re-check the compliance-block
                       override that ceo/priorities.ts applies with the
                       full CampaignIntelligence list
validate.ts             server-only. Re-resolves every number
                       (current price, cost, margin) fresh from
                       analytics/liveAnalyticsFacts.ts and re-runs it
                       through the real profitability engine
                       (analytics/profitAnalytics.ts's
                       buildProductChannelProfitAnalytics ->
                       profitability/channels.ts's projectChannel) —
                       never the FactBundle's cached snapshot, never
                       anything from the parsed intent's own numbers
                       beyond the requested magnitude. Calls
                       automation/priceAutomation.ts's new
                       assessPriceChangePolicy with automationLevel
                       hard-coded to 'assisted' — the one line that
                       structurally guarantees an AI-chat-originated
                       price change can never auto-apply, regardless of
                       the org's real configured automation level. Only
                       UPDATE_PRICE, REQUEST_APPROVAL and (Milestone 14)
                       REVIEW_CAMPAIGN currently have a real path to
                       `outcome: 'requires_approval'` (the latter two are
                       pure escalations, handled by one shared
                       validateEscalation); the other nine vocabulary
                       members are always 'not_executable' — see the
                       module comment for exactly why each one is not yet
                       wired to a real domain engine
propose.ts              server-only. proposeAction: the one function that
                       can create real state — re-derives the proposal
                       from scratch (fresh getCEOCommandCentre/
                       getProducts, not trusted from the client) and, only
                       when validation lands on requires_approval, calls
                       the pre-existing automation/proposeApproval.ts
                       (Milestone 6) — never a second approval mechanism,
                       for either a product or a campaign target. The
                       owner approves/rejects on the existing /approvals
                       page exactly as any other automation decision
```

`src/app/api/chat/route.ts` is the one HTTP entry point, session-gated
identically to every Server Action in this codebase; it remains strictly
read-only. `src/app/(dashboard)/chat/actions.ts`'s `requestActionApproval`
is the one Server Action that can create state — reachable only from the
chat page's "Request approval" button, itself only shown once
`validate.ts` has already cleared a proposal. `src/components/chat/
ChatPanel.tsx` is this codebase's **first Client Component** — a
deliberate, minimal exception to "Server Components by default," because a
chat transcript that updates as you type is the one interaction here that
cannot be a plain form submit; it holds no session detail or credential,
only the current turn's already-public response, plus (Milestone 13) the
recommendation/proposed-action cards `repository.ts` already computed.

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

**A critical bug in exactly this switch was found and fixed in Phase 11**
(`HANDOVER.md` §64) — `isDemoMode()` had read the un-negated
`isSupabaseConfigured()` instead of its negation, meaning live mode
could never actually activate even with fully valid credentials, and
had gone uncaught through ten prior milestones simply because
`COMMERCE_OS_MODE=live` had never once been set in any environment this
codebase had run in. The lesson generalises: **a safety switch that has
never been flipped is unverified, not proven** — `db:verify`,
`tsc`, and 1600+ passing tests all stayed green the entire time this bug
existed, because none of them exercised the one specific branch it lived
in. Phase 11 also found and fixed two related cases where a genuine
Supabase connectivity failure (as opposed to "no valid session") was
being silently treated as an ordinary logged-out state — `proxy.ts` and
`(auth)/login/actions.ts` — using Supabase's own `isAuthRetryableFetchError`
to tell the two apart, since the client library never throws for a
network failure, it resolves cleanly either way.

**Empty is not the same as unknown.** A live business with no orders shows
zeros, not demo figures. Aggregates that are not yet implemented return honest
empties rather than plausible numbers.

**Logout (Phase 13, `HANDOVER.md` §67) uses the same Supabase server
client as everything else** — no separate auth library, no parallel
session store. `(auth)/logout/actions.ts`'s `signOut` Server Action
calls `supabase.auth.signOut({ scope: 'local' })` (deliberately *not*
the library's default `'global'` scope, which would end every device a
member is signed in on, not just the one clicking the button — wrong
for a multi-member application) and redirects to `/login`. Verified
directly against `@supabase/auth-js`'s own implementation: the local
session/cookie is cleared regardless of whether the server-side token
revocation succeeds, so a Supabase connectivity failure during logout
still leaves the browser signed out — and `proxy.ts` re-validates the
session on every request regardless, so a stale cookie in the one
remaining edge case (the cookie write itself failing) still cannot
reach a protected route.

**Password reset (`HANDOVER.md` §71) is the one page whose identity proof
never reaches the server.** A Supabase invite/recovery link's tokens
arrive as an implicit-grant URL *fragment*
(`#access_token=...&refresh_token=...`), which browsers never send in an
HTTP request — so `(auth)/reset-password/page.tsx` has to be public in
`proxy.ts`'s `PUBLIC_PATHS` (same reasoning as `/login`: it authenticates
itself, just client-side instead of server-side) and the actual session
exchange happens entirely in `ResetPasswordForm.tsx`, a Client Component
that hand-parses the hash and calls `setSession()` directly — `@supabase/ssr`'s
`createBrowserClient` hardcodes `flowType: 'pkce'`, so its automatic
`detectSessionInUrl` handling only recognises a PKCE `?code=` query
parameter and is blind to this fragment shape, confirmed by reading the
installed package's own source rather than assumed. This was also
`src/lib/supabase/client.ts`'s first-ever caller, which surfaced a
Next.js constraint worth stating generally: `NEXT_PUBLIC_*` inlining into
the client bundle requires a **static literal** `process.env.NEXT_PUBLIC_X`
at the call site — `core/env.ts`'s dynamic `process.env[key]` helper
cannot be inlined and silently resolves to `undefined` in the browser, so
any future browser-side Supabase (or other `NEXT_PUBLIC_*`) client must
read the literal, the way `proxy.ts` and `client.ts` both now do, not
through that helper.

**Every consequential action is audited.** `audit_logs` is append-only at the
database level; UPDATE and DELETE raise an exception. `recordAudit` never
throws, so a logging failure cannot roll back a business action that succeeded,
but it does report to stderr. **This block is unconditional, confirmed
directly (Phase 14): it also blocks a `DELETE` arriving via
`ON DELETE CASCADE` from a parent `organisations` row, for every role
including the service role.** An organisation that has ever accumulated
a single audit entry can never be removed via the API again — a real,
load-bearing consequence of the append-only design, not previously
stated explicitly.

**The automation job queue (`src/lib/automation/jobs.ts`) is the one
piece of infrastructure every future real marketplace write will
eventually route through**, and (Phase 14, `HANDOVER.md` §68) is now the
first server-only, Supabase-touching module in this codebase to be both
live-verified against real Postgres and covered by a Vitest regression
test. Claiming is two independently-scoped atomic updates — a pending
job matches only `status = 'pending'`; an abandoned (stale-locked) job
matches only `status = 'running' AND locked_at < cutoff`, re-checked at
update time, not just at the earlier read — closing a real double-claim
race a single shared `.in('status', [...])` filter previously allowed.
`/api/automation/run`, `/api/automation/maintenance` and
`/api/monitoring/run` authenticate independently via
`AUTOMATION_CRON_SECRET`, never a user session (`src/proxy.ts`'s
`PUBLIC_PATHS`), by design — a scheduler is not a logged-in owner.

**The maintenance orchestrator (`automation/maintenance.ts`) is the one
scheduled entry point (Phase 15, `HANDOVER.md` §69).** `vercel.json`'s
one Vercel Cron entry calls `/api/automation/maintenance` **once
daily** (`0 3 * * *` — corrected from an original design of every 15
minutes, Phase 16 §70: the real, connected Vercel account is on the
Hobby plan, which rejects any faster cron schedule outright, confirmed
by a real failed deployment); `runMaintenance` also runs the job-queue
batch (`runScheduledJobBatch`) and every organisation's due monitors
(`runMonitoringForAllOrgs`) as two more of its seven independently
try/caught subsystem steps, monitoring immediately before the job batch
so whatever a monitor enqueues this cycle is claimable in the same run.
`/api/automation/run` and `/api/monitoring/run` call these same two
shared functions directly and remain independently callable — for
manual triggering or a finer-grained external scheduler — but are not a
second implementation, and are not required for the baseline loop.
Overlapping/duplicate scheduler invocations are serialized by the
existing single-run lock (`acquireMaintenanceRun`), proven live twice
against a genuine concurrent HTTP race — once in Phase 15 against a
local dev server, once in Phase 16 against the real production
deployment: one request succeeds, the other receives `409
already_running`. `automation/maintenanceHealth.ts`'s
`MAINTENANCE_EXPECTED_INTERVAL_MS` must always match `vercel.json`'s
real schedule — the `/automation` staleness indicator is derived from
that constant, not from `vercel.json` itself, so the two can silently
disagree if only one is changed.

**Commerce OS is deployed to a real Vercel production project (Phase
16, `HANDOVER.md` §70)**: `informax/commerce-os`, git-connected to
`github.com/tylerokkers-lang/commerce-os`, serving
`https://commerce-os-indol.vercel.app`. Every environment variable the
running application actually reads is configured there;
`SUPABASE_ACCESS_TOKEN` (a Supabase-CLI-only credential, §65) is
deliberately not among them, since no application code reads it.

**Server Actions guard themselves.** They are reachable by direct POST, not only
through the UI, so each one calls `requireWriteAccess()` rather than trusting
that a page rendered.

**Secrets never reach the browser.** Server-only modules import `server-only`.
The service role key bypasses RLS and is used solely by trusted server-side
automation.

## The four status systems

Milestone: execution reliability & unified write path. An audit found four
distinct "what state is this thing in" enums, individually well-documented
and gated, with no single place that explained how they relate. This is that
place — read it before adding a fifth, or before writing any code that reads
one of these and assumes it answers a question it was never designed to
answer.

| Column | What it represents | Owning module | Transitions | Kind of state |
|---|---|---|---|---|
| `products.stage` (`product_stage`) | How far this product has progressed through Commerce OS's own discovery-to-trading pipeline — a maturity/position fact. | `products/lifecycle.ts` | Restrictive `ALLOWED` graph (`planTransition`); append-only `product_stage_transitions`. | **Business state.** Never touched by a marketplace read or write. |
| `products.decision` / `channel_product_decisions` (`product_decision`) | Whether the *operator* currently permits Commerce OS to act on this product at all (overall, and per channel). | `products/decision.ts`, `products/decisionGate.ts`, `products/channelDecision.ts` | Any value to any other (a permission flag, not a workflow); append-only `*_transitions`. | **Decision state (intent).** A statement about what the operator has allowed, not about what has happened. `add`/`test` are the only values `decisionGate.ts` treats as "may proceed" — nothing else about this column implies eligibility, profitability, or compliance passed. |
| `channel_products.workflow_state` (`marketplace_listing_state`) | Where a specific listing sits in Commerce OS's own publication workflow — discovered → evaluating → approved → ready_to_list → pending_approval → published → paused/ended. | `marketplaces/listingLifecycle.ts` | Restrictive `ALLOWED` graph (`planListingTransition`); append-only `channel_listing_transitions`. | **Execution/workflow state**, tracked by Commerce OS. `published`/`paused` here mean "Commerce OS attempted and, per `channel_listing_transitions`' own evidence column, verified this transition" — see the rule below. |
| `channel_products.status` (`channel_listing_status`) | The coarse, UI-facing category the rest of the app renders (`not_listed/draft/review_required/blocked/testing/live/paused/removed`). | Written only by the same functions that write `workflow_state` (`publicationService.ts`) or reconcile a verified external change (`automation/actions.ts`'s `reconcileChannelProduct`) — never a third, independent writer. | Not a state machine of its own; a coarser projection of `workflow_state`, written in lockstep by convention, not by a database constraint. | **Claimed external state** — what Commerce OS currently believes the marketplace itself shows. |

**The rule that matters:** `channel_products.status`/`workflow_state` may only
ever move to `live`/`published` or `paused` as the result of a real connector
call whose result was independently read back and confirmed
(`MarketplaceConnector.verifyListingState`) — never from an internal decision
alone, no matter how confident that decision is. This was a real, live bug
until this milestone: `handleProductPause`'s own doc comment used to call its
write "a real, verified local write" while never once calling a connector —
Commerce OS's own record could say a listing was paused while the real
Shopify listing stayed untouched and orderable. `handleProductPause`/
`handleProductResume` (`automation/handlers/productHandlers.ts`) and
`publishLive`/`pauseListing` (`marketplaces/shopify/publicationService.ts`)
now all follow the same SUBMIT → VERIFY → RECONCILE shape `priceExecution.ts`
already used for price writes: capability check → circuit-breaker-gated
connector call → read the listing back → reconcile `status`/`workflow_state`
**only if verified** → record the real outcome, honestly, as
`verified`/`failed`/`uncertain` — an internal `product_decision` of `add` or
an `automation_action` marked `succeeded` must never be read, by any future
code, as proof a marketplace listing is actually live or actually paused.

`overrideSellingPrice` (`publicationService.ts`) is a known, documented
exception, not yet fixed: it writes `channel_products.price_minor` directly
with no connector call, correct when used pre-publication to set the price a
future `createDraft` will use, but capable of silently diverging Commerce
OS's price record from a marketplace's real price if called against an
already-`published` listing. Restricting it to pre-publish states, or routing
it through `priceExecution.ts`'s real pipeline once a listing is live, is
flagged as follow-up work.

## The ten-stage conceptual product lifecycle

Milestone: autonomous decision & capability layer, Part 3. A conceptual
lifecycle — discovered → researching → evaluating → eligible → testing →
published → monitoring → optimising → paused → retired — was proposed for
Commerce OS to manage a product through. None of it needed a new enum: every
stage is already representable by composing the four systems above, and
forcing a fifth, flatter enum would have re-introduced exactly the ambiguity
those four exist to prevent (a single column trying to answer more than one
question at once).

| Conceptual stage | Represented by | Note |
|---|---|---|
| Discovered | `product_stage = 'discovered'` | Exact match. |
| Researching | `product_stage = 'researching'` | Exact match. |
| Evaluating | `product_stage ∈ {'supplier_review', 'compliance_review'}` | The existing model is *more* granular than the concept, not less — "evaluating" is genuinely two distinct, ordered gates. |
| Eligible | `product_stage = 'approved'` | Cleared every gate; not yet listed anywhere. |
| Testing | `product_stage = 'testing'` | Exact match — and distinct from `product_decision = 'test'` (operator permission, a different axis; see "The four status systems" above). A product can be at stage `testing` under decision `add`, or stage `approved` under decision `test` — the two never collapse into each other. |
| **Published** | **Not a `product_stage` value at all** — it is `channel_products.workflow_state = 'published'` (per channel), the execution-state system. | This is the one genuine trap the conceptual list sets: a product at stage `testing` ("live on at least one channel, on a limited budget" — `products/lifecycle.ts`'s own words) is *already* correctly, simultaneously `workflow_state = 'published'` on that channel. Treating "published" as a product-level lifecycle stage would either duplicate `workflow_state` or, worse, invite exactly the bug the previous phase fixed: an internal stage saying "published" without a verified external write behind it. |
| Monitoring | Not a state — a standing process (`src/lib/monitoring/monitors/*.ts`) that runs against every non-terminal product regardless of stage, not a position a product occupies. | No column needed; "is this product being monitored" is answered by "is it non-terminal," not by a flag. |
| Optimising | `product_stage ∈ {'proven', 'scaling'}` | The existing progression already models this arc; `mature`/`declining` continue it. |
| Paused | `product_stage = 'paused'` (business-level: stop evaluating/spending on this product) **and, independently**, `channel_products.workflow_state = 'paused'` (channel-level: this one listing is off) | Two different, deliberately non-identical "paused" facts — a product can be business-paused with every channel listing already ended, or a single channel can be paused while the product itself continues at `testing`/`proven`. `handleProductPause`/`handleProductResume` (previous phase) only ever write the channel-level fact, through a verified connector call — never the business-level `product_stage`, which stays an explicit, separate operator/pipeline decision. |
| Retired | `product_stage ∈ {'removed', 'rejected'}` | `rejected` (never traded) vs `removed` (traded, then withdrawn) — the existing terminal states already distinguish *why* a product stopped, which a single flat "retired" would lose. |

## Automation levels

Milestone: autonomous decision & capability layer, Part 8. `docs/PRINCIPLES.md`
§5 already defines four levels on the `automation_level` enum (`manual`,
`assisted`, `supervised`, `autonomous`) applied per action type. A six-rung
conceptual ladder (observe / recommend / approval / low-risk auto /
controlled marketplace auto / full autonomy) was proposed on top of that.
The four existing levels plus the connector capability flags already
introduced for other reasons (`writeListings`, `createListings`,
`verifyWrites` — all `false` on every real marketplace connector today)
turn out to already express all six rungs; no new enum value, column, or
flag was added.

| Conceptual level | How it's actually reached today |
|---|---|
| 0 — Observe | The baseline, not a setting: monitors (`src/lib/monitoring/monitors/*.ts`) always read facts regardless of `automation_level` — there is no way to turn fact-reading off per action type, only execution. |
| 1 — Recommend | `automation_level = 'manual'`. Every domain engine (`priceAutomation.ts`'s `levelPermitsAutoApply`, and the equivalent checks in the other six) routes to a recommendation only — no `automation_actions` row proposing real execution. |
| 2 — Approval | `automation_level = 'assisted'` (or the domain's own structural floor — advertising campaign actions sit *here* regardless of level, by explicit, permanent design; see `advertisingAutomation.ts`'s module comment). The action is proposed for real, through the same `ai_decisions` approval workflow every level-2-and-above action uses, and only executes on an owner's explicit approval. |
| 3 — Low-risk auto | `automation_level ∈ {'supervised', 'autonomous'}` **and** `policyEngine.ts`'s other checks all pass (kill switch open, business settings configured, financial/percentage limits satisfied, risk not `'unknown'`). Reachable today for actions that don't require a marketplace capability at all — e.g. the internal pause/resume reconciliation once a connector *does* support the write. |
| 4 — Controlled marketplace auto | Everything in level 3, **plus** the specific connector's `writeListings`/`createListings`/`verifyWrites` capability flags being `true` for the specific write in question. **Not reachable today for any real connector** — Shopify, Amazon, and eBay all declare these `false` (or, for Amazon, `true` behind an honestly-stubbed method — see the marketplace capability matrix). This is the actual, current, load-bearing boundary this phase does not cross. |
| 5 — Full operating autonomy | Every action type at `autonomous` with no structural approval floor anywhere. **Not fully reachable even in principle without further code changes** — advertising campaign actions, for one concrete example, have no code path to `auto_permitted` at all today, by deliberate design, independent of settings. |

Levels 0-3 are exercised by real code today (gated by settings, not by
missing capability). Level 4 is one flipped capability flag per connector
away, deliberately not flipped in this phase. Level 5 requires further,
deliberate code changes in at least the advertising domain before it is
even structurally possible — it is not merely "not enabled," it does not
yet exist as a reachable code path.

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
