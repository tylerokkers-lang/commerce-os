# Security

A review of the automation and monitoring engines' security-relevant
surface, written as part of Milestone 7 and extended for Milestone 8. This
is not a certification — it is what was actually checked, what it found,
and what remains genuinely unverified because the credentials or
infrastructure to verify it do not exist in this environment.

## Row level security

Every org-scoped table has RLS enabled and is asserted by `npm run db:verify`
(`0009_rls.sql`'s generic loop, extended per-milestone). Two shapes exist:

- **Managed tables** (`business_settings`, `products`, `suppliers`,
  `channel_products`, `orders`, …): readable by any org member, writable by
  `owner`/`admin`, deletable by `owner` only.
- **History/decision tables** (`audit_logs`, `automation_actions`,
  `automation_jobs`, `ai_decisions`, `automation_runs`, product/supplier
  scores): **read-only through RLS**. Every write goes through the service
  role in server-side code (`recordAudit`, `createAutomationAction`,
  `enqueueJob`, `proposeApproval`, …), so a member with only read access can
  still *cause* an audit entry or a queued job without being able to forge
  or edit one directly.

`automation_actions`/`automation_jobs` (Milestone 6) and the columns
Milestone 7 added to `automation_actions` (`external_ref`,
`verification_status`, `reconciliation_status`) follow the read-only
pattern exactly — checked in `0020_rls_automation_engine.sql`. Milestone
8's `domain_events`, `monitor_observations` and `monitor_runs` follow the
identical pattern — checked in `0023_rls_monitoring_events.sql` — for the
same reason: a monitoring history a viewer could edit or delete would not
be a history. Milestone 9's four tables are all read-only through RLS as
well — checked in `0025_rls_global_markets.sql` — org members read,
service role writes, with no exception: `exchange_rates` and
`market_expansion_assessments` are append-only history (the same
`forbid_mutation` trigger as `audit_logs`); `supplier_market_capabilities`
and `market_compliance_assessments` are mutable current-state tables (a
`touch_updated_at` trigger, matching `supplier_products`/
`compliance_records`) but still writable only by the service role — a
member cannot forge a compliance pass or a supplier capability by writing
to the table directly, only cause one to be recorded through the real
assessment/monitoring code.

**Not verified**: real RLS *enforcement* under an authenticated Supabase
session with a real JWT. `npm run db:verify` checks that policies exist and
that the append-only triggers fire; it does not — and cannot, without a
live project and real users — prove that a policy correctly denies a
specific cross-tenant query at the Postgres planner level. This is the same
boundary as the rest of the live/demo split in this codebase.

## Organisation isolation

Every `AutomationStore`/`FactsLoader` method takes `orgId` explicitly and
every query filters by it — there is no code path that reads or writes
across organisations. `tests/automation-engine-e2e.test.ts` has a dedicated
test proving one org's automation actions never appear in another org's
`countRecentActionsForEntity` count, even for the identical entity id.
`liveSubjects.ts`'s discovery queries (Milestone 8.5) follow the identical
rule — every one of its paginated queries carries `.eq('org_id', orgId)`,
including the joins across `supplier_products`/`products`/`channel_products`
and the `orders`/`order_items`/`refunds` queries behind real sales
aggregation. `analytics/liveAnalyticsFacts.ts` (Milestone 10) follows the
same rule using the same shared `supabase/paginate.ts` helper — every
query it issues (orders, order_items, refunds, channel_products, suppliers,
supplier_connectors, supplier_products, fulfilments, shipments,
compliance_records) is scoped by `org_id`, and `getAnalyticsDashboard`
resolves `orgId` from the caller's own session, never from a parameter a
client could supply.

The job queue itself (`automation_jobs`) is *not* org-partitioned at the
claim level — `claimNextJob` picks the next due job across all
organisations, matching how a single worker pool serving multiple tenants
actually works in production (the same design a real Postgres-backed queue
with the service role bypassing RLS would use). Isolation is enforced by
every downstream operation being scoped to the claimed job's own `org_id`,
not by the claim query itself.

## Scheduler authentication

`POST /api/automation/run` and, since Milestone 8, `POST
/api/monitoring/run` have no user session — a scheduler is not a logged-in
owner. Both are authenticated by the same shared secret
(`AUTOMATION_CRON_SECRET`) compared with `crypto.timingSafeEqual`, not `===`
(factored into `src/lib/core/schedulerAuth.ts` during Milestone 8 so both
routes share one implementation rather than two copies that could drift),
so a wrong guess cannot be narrowed down by response timing. Once Supabase
is configured, a missing or absent secret refuses every request (503) rather
than running unauthenticated against a live database. The secret is read
from the environment only, never logged, and never returned in any
response.

**Not verified**: the secret has never been exchanged over a real HTTPS
connection to a real scheduler. The comparison logic itself is unit-testable
in principle but has no dedicated test in this codebase yet — a reasonable
gap to close before relying on it in production.

## Connector credentials

Every marketplace/supplier connector's required credentials are declared as
**environment variable names**, never values, in `descriptor.requiredCredentials`.
`isConfigured()` reads them from `process.env` at call time and returns
`false` — not an error, not a guess — when any are absent, which is what
keeps the whole application able to boot and run fully in demo mode with
zero credentials. `.env.example` documents every variable name with no
values, and is the only `.env*` file this repository actually commits
(the `.gitignore`'s `.env*` pattern otherwise swallows it — fixed during
Milestone 6).

No connector ever logs a credential value. `shopifyRequest`/`spApiRequest`
error messages include the HTTP status and path, never headers or bodies
that could carry a token. Amazon's SigV4 signing (`amazonSigning.ts`) derives
a per-request signature from the AWS secret key but the key itself never
appears in a signed request's headers (SigV4's entire purpose) or in any log
line.

**Never exposed to the browser**: the Supabase service role key
(`createServiceSupabase`), and every marketplace/supplier API credential,
live only in server-only modules (`import 'server-only'` at the top of every
file that touches one) and are read via `process.env`, which Next.js does
not expose to client bundles unless prefixed `NEXT_PUBLIC_`. None of these
variables carry that prefix.

## Approval permissions

`canApprove(session)` (`security/session.ts`) restricts approving or
rejecting a decision to the `owner` role. `approveDecision`/`rejectDecision`
(`approvalWorkflow.ts`) are Server Functions, reachable by direct POST, so
each independently re-checks the role rather than trusting that the
Approvals page rendered the button — the same rule `docs/ARCHITECTURE.md`
states for every Server Action in this codebase. Kill-switch actions
(`pauseAll`, `resumeAll`, `toggleCategory`) carry the same server-side
`role !== 'owner'` guard.

## Audit immutability

`audit_logs` rejects `UPDATE` and `DELETE` at the trigger level
(`forbid_mutation`), asserted by `npm run db:verify` by actually attempting
both and confirming they raise. This has not changed since Milestone 1 and
Milestone 7 did not touch it. `automation_actions`/`automation_jobs`
themselves are *not* append-only (their `status` genuinely transitions as a
job runs) — the append-only guarantee lives in the paired `audit_logs`
entry every state change writes via `recordAudit`, not in the mutable
record itself. This mirrors the same two-tier pattern as `orders`
(mutable) plus `order_status_transitions` (append-only) from Milestone 5.

## Write permissions on external actions

Nothing in the automation engine can execute arbitrary code from a job
payload. `worker.ts`'s `HANDLERS` map is a closed, reviewable set — a job's
`job_type` selects a handler function by exact string match; there is no
`eval`, no dynamic `import()` of a payload-supplied path, and no code path
that treats any part of a job payload as executable. A payload only ever
supplies *data* to a fixed handler.

## Monitoring never performs a business action (Milestone 8)

`src/lib/monitoring/registry.ts`'s `MONITORS` map is the same closed,
reviewable-set pattern as `worker.ts`'s `HANDLERS` — a monitor key selects a
monitor by exact string match, never by evaluating anything from
configuration or a payload as code. More importantly, no monitor module
imports a marketplace connector's write methods, `priceExecution.ts`, or
`supplierSwitchExecution.ts` — the brief's "monitoring observes, automation
decides and acts" separation is enforced by what these modules are allowed
to depend on, not only documented. `marketplaceMonitor.ts` calls a
connector's *read* method (`fetchListings`) only; every subsequent write
happens later, inside the automation engine, once a job the monitor
enqueued is actually claimed and its policy checked.

`EVENT_TO_JOB_MAPPING` (`registry.ts`) is the single, auditable point where
an event type is allowed to become a job — `tests/monitoring-registry.test.ts`
asserts every monitor's real `enqueueJob` calls agree with this table, and
separately asserts every non-null mapped job type is a real, registered
`worker.ts` handler, so this table cannot silently drift into naming a job
type that does not exist.

## What Milestone 14 changed here (Advertising Intelligence & Optimisation)

Milestone 14 extends Commerce Intelligence to advertising campaigns without
opening any new execution surface — no live advertising platform connector
exists in this codebase (confirmed by inspection before writing any code),
so nothing here can pause a campaign, change a budget, or change bids for
real. The threat model below is organised by the twelve categories the
brief asked to cover explicitly.

- **Prompt injection**: no new surface. Advertising facts flow into the
  system prompt through the same `serializeFactBundle` path every other
  fact category already uses (Milestone 12's guardrails, unchanged); a
  campaign name is just more code-derived text in the facts block, never a
  new instruction channel. `tests/chat-advertising.test.ts` proves a system
  prompt containing real campaign data still produces an Anthropic request
  with no `tools` field.
- **AI hallucinating campaign performance**: structurally bounded the same
  way price/margin figures already are. `buildOfflineAnswer`'s advertising
  section and the live-model system prompt both only ever contain
  campaign figures `factBundle.ts` derived from
  `AdvertisingIntelligence.campaigns` — the model is never asked to
  produce a ROAS, spend, or classification figure itself, only to discuss
  ones already computed. **Not proven**: as with every other topic
  (Milestone 12), no purely textual defence can guarantee the live model's
  prose never mischaracterises a real figure it was given — the guarantee
  is that it cannot invent a campaign, a number, or an action that does
  not already exist in the bundle.
- **Incorrect currency aggregation**: the `advertising` table has no
  currency column — every row is treated as the org's own
  `base_currency`, resolved once by `liveAdvertisingFacts.ts`
  (`loadOrgCurrency`, the same resolver `liveAnalyticsFacts.ts` already
  used), so there is no per-row currency to mix. The one place two
  different figures are combined — `buildAdvertisingScorecard`'s TACOS
  (ad spend ÷ org sales revenue) — is computed only when
  `getAdvertisingIntelligence` confirms `salesFacts.currency ===
  adFacts.currency` and `salesFacts.mixedCurrencies.length === 0`;
  otherwise `orgRevenueMinor` is passed as `null` and TACOS is reported
  `unavailable`, never silently computed across a mismatch. This is the
  same `resolveSalesAnalyticsSafely` discipline Milestone 11 established,
  applied at the one cross-figure join this milestone adds.
- **Incorrect profitability calculations**: `resolveCampaignProfitability`
  never reimplements profitability — it reads `profitability/channels.ts`'s
  already-real `breakEvenAdSpend` off the same
  `ProductChannelProfitAnalytics` every other feature uses, and explicitly
  checks `fact.spend.value.currency !== breakEven.currency` before ever
  comparing the two, returning `actualAdSpendPerUnit: null` rather than a
  silently wrong comparison on a mismatch. `classifyCampaign`'s
  `poor_profitability` branch only fires on `exceedsBreakEven === true`,
  never on a `null` (unknown) result.
- **Stale campaign state**: `ai/actions/propose.ts` (the only place a
  campaign proposal can become a real `ai_decisions` row) reloads
  `getCEOCommandCentre()` fresh and rebuilds the `FactBundle` from scratch
  before re-running `extractActionIntent`/`validateActionIntent` — the
  same "never trust a round-tripped proposal" discipline Milestone 13
  established for price changes, extended to campaigns without a second
  code path: `propose.ts` has exactly one reload-and-revalidate flow for
  both entity types.
- **Manipulated user prompts**: `matchCampaign` (`intentExtraction.ts`)
  follows the identical discipline as `matchProduct` — it matches only
  the *user's own* typed message against real, already-known campaign
  names from the current turn's bundle, and returns `null` on zero or
  more than one match rather than guessing. Proven directly
  (`tests/chat-campaign-intent.test.ts`): a fabricated campaign name, an
  ambiguous substring match, and an embedded fake JSON action block
  naming a fabricated `matchedCampaignKey` all produce no intent at all.
- **AI bypassing approval workflows**: `ProposalOutcome` still has no
  `'approved'`/`'executed'` member (unchanged from Milestone 13) — a
  matched `REVIEW_CAMPAIGN` intent can only reach `'requires_approval'`
  (`validateEscalation`) or fail validation entirely, never anything that
  looks approved. `PAUSE_CAMPAIGN`/`INCREASE_BUDGET`/`DECREASE_BUDGET` are
  always routed to `reviewOnly()`, which hardcodes `outcome:
  'not_executable'`, `executable: false` — there is no branch anywhere in
  `validate.ts` that can mark one of these three types executable, because
  `EXECUTABLE_ACTION_TYPES` (a closed array checked by
  `tests/chat-action-vocabulary.test.ts`) does not contain them.
- **Automatic advertising spend changes**: impossible by construction, not
  by policy — this codebase has no marketplace/advertising connector with
  a budget-write or pause-write method at all (confirmed by search during
  Phase 1 investigation before any Milestone 14 code was written). The
  `/advertising` page has no "Pause" or "Increase budget" control anywhere
  on it; the page's own explanatory card states plainly that the only real
  path from a recommendation to a trackable decision is asking chat to
  raise a `REVIEW_CAMPAIGN` escalation, which still only ever reaches
  `/approvals` — never a fake button that looks like it executes something
  it cannot.
- **Missing/incomplete data**: every campaign figure is a `Metric<T>`
  (`factMetric`/`calculatedMetric`/`unavailableMetric`) — a campaign with
  no clicks never reports a `0%` conversion rate, it reports
  `unavailable` with the reason. `classifyCampaign`'s first check is
  `sampleSizeAdequate` (`MIN_IMPRESSIONS_FOR_SIGNIFICANCE`/
  `MIN_CLICKS_FOR_CONVERSION_SIGNIFICANCE`), returning the honest
  `insufficient_data` classification rather than guessing from a handful
  of impressions; `declining_performance` additionally requires
  `MIN_DAYS_FOR_TREND_COMPARISON` days and an adequately-sampled previous
  window before comparing trends, so a two-day dip is never reported as a
  decline.
- **Cross-tenant campaign leakage**: `loadAdvertisingFacts(orgId, ...)`
  (`liveAdvertisingFacts.ts`) filters by `org_id` using the same
  `supabase/paginate.ts` helper every other Milestone 10 live loader
  already uses, and `getAdvertisingIntelligence()` resolves `orgId` from
  the caller's own session (`requireSession()`), never from a parameter a
  client could supply — the same rule documented above for every other
  analytics query.
- **Demo vs live mode**: `getAdvertisingIntelligence()`'s demo branch
  returns genuinely empty `campaigns`/`scorecard` — it never injects
  `demoAdvertisingScenarios()`'s fixture rows into the real query path.
  The seven demo scenarios are narrative text computed by running the
  real `classifyCampaign`/`buildAdvertisingScorecard` functions against
  fixed, self-contained fixture data with a fixed `NOW`, exactly the
  pattern `demo/analytics.ts`/`demo/ceo.ts` already established — and
  confirmed live in the browser this milestone: with `ANTHROPIC_API_KEY`
  unset and the default demo session, asking chat "What is my advertising
  ROAS and are any campaigns wasting money?" honestly answered "No
  advertising campaign data for this period", even though seven demo
  scenarios render on `/advertising` in the same session.
- **Auditability**: no second approval mechanism was introduced.
  `propose.ts`'s campaign path creates exactly one `ai_decisions` row via
  the pre-existing `proposeApproval()` (Milestone 6), carrying the same
  read-only-through-RLS posture documented above — a campaign proposal is
  indistinguishable, from an audit standpoint, from any other proposal
  this codebase has ever created.
- **A real correctness gap found and fixed, not security-relevant in the
  credential/access-control sense but relevant to auditability**:
  `ceo/priorities.ts`'s advertising section originally handled
  `wasted_spend`/`poor_profitability`/`declining_performance`/
  `scale_opportunity` but had no branch for `high_acos_low_roas` — a real,
  `severity: 'high'` classification that the health scorecard already
  surfaced (`healthScorecard.ts`'s `advertisingArea`) but that never
  reached the CEO priority queue at all, a silently-dropped alert.
  Fixed by adding the missing branch, proven by a dedicated test
  (`tests/ceo-advertising-integration.test.ts`).
- **Not verified**: real RLS enforcement under an authenticated session
  and actual Anthropic API behaviour (both the same pre-existing,
  unchanged boundaries documented above) — Milestone 14 adds no new
  instance of either. Also not verified: `validate.ts`'s campaign
  escalation path and `propose.ts`'s campaign proposal path are
  `server-only` and cannot be imported into Vitest at all in this project
  (the same established limitation Milestone 13's price-change path has);
  their behaviour is proven only by the pure `intentExtraction.ts`
  campaign-matching tests plus code inspection, not by a live
  `REVIEW_CAMPAIGN` proposal actually reaching `/approvals` in the
  browser — this environment's demo session has no real campaign data to
  match against, so that end-to-end path is genuinely untested live.

## What Milestone 13 changed here (Commerce Intelligence — Analyse, Recommend & Propose)

Milestone 13's "AI proposal is untrusted input" requirement gets a
structural answer, not just a validation pass — the same pattern Milestone
12 already used for reference chips (code-derived, never model-derived),
extended one step further:

- **The model is never asked to produce the actionable structure at all.**
  A "Proposed Action" is never parsed out of the model's (or the offline
  fallback's) reply. `ai/actions/intentExtraction.ts` reads only the
  *user's own* typed message and matches it against real, already-known
  products from the current turn's `FactBundle` — an unmatched or
  ambiguous reference produces no proposal, never a best-effort guess.
  This means the entire class of "malicious structured output" / "malformed
  AI output" attack this milestone's brief asks to defend against has no
  surface to land on: there is no AI-authored JSON anywhere in this path
  for a prompt-injected instruction to forge. Proven directly
  (`tests/chat-intent-extraction.test.ts`): a message embedding a fake
  JSON action block naming a fabricated id and `"approved":true` produces
  no intent at all, because the action-keyword/product-name matching
  never looks at JSON structure and the fabricated id never appears in
  the real product list it matches against.
- **Every number is re-resolved fresh from real data, never trusted from
  the intent or the cached `FactBundle`.** `ai/actions/validate.ts` calls
  the same live, org-scoped `analytics/liveAnalyticsFacts.ts` reads
  Milestone 10 already established, then the real profitability engine
  (`profitability/channels.ts`'s `projectChannel`, via
  `analytics/profitAnalytics.ts`) — never a second calculation.
- **An AI-chat-originated price change can never auto-apply, structurally,
  regardless of the organisation's real configured automation level.**
  `validate.ts` calls the new `automation/priceAutomation.ts`
  `assessPriceChangePolicy` with `automationLevel` hard-coded to
  `'assisted'` — per that module's own logic (unchanged, only exercised
  differently), `'manual'`/`'assisted'` can only ever reach `block` or
  `require_approval`, never `allow_automatic`. There is no parameter, no
  override, and no code path in `ai/` that passes a different level.
  Proven directly (`tests/automation-price-policy.test.ts`).
- **The AI cannot approve its own recommendation, cannot simulate
  approval, and cannot mark anything approved.** `ProposalOutcome` (a
  closed type) has no `'approved'`/`'executed'` member at all — the only
  two outcomes that can result from a successful validation are `'blocked'`
  and `'requires_approval'`. Approval itself only ever happens through the
  pre-existing, unchanged `/approvals` page and
  `automation/approvalWorkflow.ts`'s `approveDecision` (Milestone 6),
  which independently re-checks `canApprove(session)` (`owner` role only)
  exactly as it already did before this milestone.
- **No new approval mechanism, no new write path beyond one call into an
  existing one.** `ai/actions/propose.ts`'s `proposeAction` is the single
  function in this milestone that can create real state, and it does so
  by calling the pre-existing `automation/proposeApproval.ts` (Milestone
  6) — the same function `productHandlers.ts`'s job handlers already call.
  It creates one `ai_decisions` row, nothing else; `ai_decisions` already
  carries the same RLS posture documented above (read-only for org
  members, service-role-only writes).
- **Re-derives from scratch rather than trusting a round-tripped
  proposal.** The only thing the client ever sends back to
  `requestActionApproval` (`src/app/(dashboard)/chat/actions.ts`) is the
  user's own original message text — the same text it already had.
  `proposeAction` reloads `getCEOCommandCentre()`/`getProducts()` fresh
  and re-runs the entire `intentExtraction`/`validateActionIntent`
  pipeline before ever calling `proposeApproval`, the same "materially
  changed facts invalidate a stale decision" discipline
  `approveDecision` already applies one step later, at the owner's actual
  approval.
- **Cross-tenant access remains structurally impossible for the same
  reason it already was.** Every function `ai/actions/` calls
  (`loadProductChannelProfitFacts`, `getAutomationSettings`,
  `getComplianceIssues`, `getProducts`, `getCEOCommandCentre`) resolves
  `orgId` from the session Milestone 12's `requireSession()` already
  established — no new function in this milestone accepts a
  caller-supplied `orgId` or entity id from outside that session's own
  already-loaded facts.
- **A real, previously-latent bug found via browser verification, not by
  inspection**: `validate.ts`'s live price-lookup path
  (`loadProductChannelProfitFacts`) had no demo-mode branch — unlike
  every other repository function in this codebase, which checks
  `session.isDemo` before ever calling `createServiceSupabase()`. In the
  default, credential-free demo session (this environment's actual
  state), asking the chat to propose a price change threw, and
  `/api/chat` returned a bare `500` rather than the honest "demo mode has
  no live data" message every other feature gives. Fixed with an explicit
  `session.isDemo` check in `validateUpdatePrice`, matching the pattern
  every other repository function already follows. Not unit-tested
  directly (the function is `server-only`), but reproduced and confirmed
  fixed live in the browser (`POST /api/chat` returning `200` with an
  honest `outcome: 'invalid'` proposal afterwards, where it previously
  returned `500`).
- **Not verified**: real RLS enforcement under an authenticated session
  (the same pre-existing boundary documented above, unchanged by this
  milestone) and actual Anthropic API behaviour (no `ANTHROPIC_API_KEY`
  exists in this environment — see Milestone 12's section above, which
  this milestone does not change).

## What Milestone 12 changed here (Commerce Intelligence chat, Phase 1: read-only)

The chat's threat model is different in kind from every prior milestone —
the new untrusted input is free text a user types, not a payload shape a
server already controls — so it gets its own section rather than a short
paragraph.

- **The model is never given tool/function-calling access.** This is the
  primary, structural guarantee, not a prompt-level one:
  `src/lib/ai/anthropicRequest.ts`'s `AnthropicCreateParams` — the one
  place a request to the Anthropic API is shaped — has no `tools` field
  anywhere, and `buildAnthropicRequest`'s pure construction is unit tested
  to confirm this (`tests/chat-anthropic-request.test.ts`). A `ChatProvider`
  (`src/lib/ai/types.ts`) can only turn text into more text; there is no
  code path from a chat turn to a database query, a mutation, or an
  execution pipeline, regardless of what the conversation contains.
- **No new write path.** Every function in `src/lib/ai/` is either a pure
  computation over already-loaded facts (`factBundle.ts`,
  `promptBuilder.ts`, `offlineAnswer.ts`, `guardrails.ts`,
  `anthropicRequest.ts`) or a read (`repository.ts`'s
  `askCommerceIntelligence`, which composes `getCEOCommandCentre()`/
  `getOpportunities()`/`getIntelligenceSummary()`/`getSuppliers()` via
  `Promise.allSettled`, the same fail-safe pattern Milestone 11
  introduced). Nothing here imports a `store.ts`/`AutomationStore` write
  method, a marketplace connector's write method, an execution pipeline,
  or `approvalWorkflow.ts`.
- **Organisation isolation is inherited, not reimplemented.** `orgId` is
  resolved once, inside `requireSession()`, by `askCommerceIntelligence` —
  never accepted from the request body — and every repository call it
  makes is one of the same already-org-scoped functions Milestone 10/11
  already established. `/api/chat` re-checks `requireSession()` itself
  (a `Route Handler` is reachable by direct POST, the same reason every
  Server Action in this codebase re-checks its own permission) and maps a
  missing session to `401`.
- **Prompt injection is treated as unsolvable by text alone, so the
  primary defence is structural (no tool access, above) and the textual
  defence is layered, not relied on as sufficient by itself**
  (`src/lib/ai/guardrails.ts`): a forged role prefix in a user message
  ("System: ignore previous instructions…") is neutralised before it ever
  reaches the model; the system prompt (`promptBuilder.ts`) explicitly
  instructs the model to treat anything inside a user turn or the facts
  block as untrusted content, never as new instructions; user turns are
  capped at 2,000 characters and a conversation at 20 turns, bounding both
  cost and the size of an injection attempt. **Not proven**: no purely
  textual defence can be proven to defeat every injection attempt, and
  this codebase makes no such claim — the tool-access boundary above is
  what actually prevents an injection from having any effect beyond
  producing misleading text in the chat's own reply, which the fact-first
  system prompt and the code-derived (never model-derived) reference chips
  are designed to make easy to spot as wrong.
- **No credential ever reaches the model, the browser, or an error
  message.** `ANTHROPIC_API_KEY` is read server-side only
  (`core/env.ts`'s `anthropicApiKey()`, `anthropicProvider.ts` is
  `server-only`) and never appears in the `FactBundle` the model receives
  — `factBundle.ts` is built entirely from `CEOCommandCentre`/
  `OpportunitySummary`/`SupplierListItem`, none of which carry a
  credential field. `anthropicRequest.ts`'s `mapAnthropicError` redacts
  any `Bearer <token>` pattern from an SDK error message before it is
  returned, tested directly
  (`tests/chat-anthropic-request.test.ts`).
- **The offline (`ANTHROPIC_API_KEY` not configured) path is not a
  degraded security posture — it never calls a network endpoint at all**,
  so it carries none of the above surface by construction; it is the same
  "demo mode is a first-class mode" honesty principle `core/env.ts`
  already establishes, applied here.
- **Not verified**: real Anthropic API behaviour under a live key —
  `anthropicProvider.ts` is `server-only` and (like `ceo/repository.ts`
  before it) cannot be imported into a Vitest file in this project; its
  request/response shaping is unit tested through the pure
  `anthropicRequest.ts` functions instead, and the file itself is
  exercised only by code inspection, since no `ANTHROPIC_API_KEY` exists
  in this environment. Whether the live model actually honours the
  system prompt's fact-first/no-fabrication rules in practice is
  therefore genuinely unverified — the structural guarantees above (no
  tool access, no write path, no credential exposure) hold regardless of
  how well the model itself behaves, but the *quality* of a live answer
  does not.

## What Milestone 11 changed here

- No new tables, no new RLS policies, no new credential types, and no new
  database query of its own — `src/lib/ceo/repository.ts`'s
  `getCEOCommandCentre()` composes four existing, already-org-scoped
  repository calls (`getAnalyticsDashboard`/`getMonitoringStatus`/
  `getAutomationStatus`/`getPendingApprovals`), each of which
  independently resolves `orgId` from the current request's own session
  via `requireSession()` — there is no code path anywhere in this
  milestone that accepts a caller-supplied `orgId`, so cross-organisation
  access is structurally impossible here for exactly the same reason it
  already was in the four functions being composed.
- No new write path: every function in `ceo/` (`buildPriorities`,
  `buildBusinessHealthScorecard`, `getCEOCommandCentre`) is a read or a
  pure computation over already-loaded facts. The dashboard's action
  links (`actionHref` on a `Priority`, the drill-down links throughout
  `/`'s page) are plain navigation to existing pages
  (`/approvals`, `/automation`, `/suppliers/[id]`, …) — none of them
  mutate anything directly; approving or rejecting still goes through
  `/approvals`'s existing `approveApproval`/`rejectApproval` Server
  Actions (Milestone 6), unchanged by this milestone.
- **New in this codebase**: `getCEOCommandCentre()` is the first
  repository function to use `Promise.allSettled` instead of a bare
  `Promise.all` across its underlying calls, so a single source failing
  (a transient error from `getAnalyticsDashboard`, say) falls back to a
  safe empty/unknown value — recorded in the response's
  `dataSourceFailures` array, which the UI surfaces as a visible warning
  banner rather than silently rendering a partial dashboard as if it were
  complete. This is a defence against a genuinely different failure mode
  than RLS/credentials (a healthy-but-momentarily-erroring dependency),
  not a security boundary change, but it is a new resilience pattern
  future repository composition functions should follow.

## What Milestone 10 changed here

- No new tables, no new RLS policies, no new credential types —
  `analytics/liveAnalyticsFacts.ts` reads columns and tables every prior
  milestone's RLS policies already govern (see `docs/DATABASE.md`).
- No new write path was introduced anywhere in `analytics/` — every
  function in the module is a read (either a pure computation over
  already-loaded facts, or a `select`-only Supabase query). Analytics
  cannot change a price, a supplier, a listing, an order, a refund, or
  compliance state, by construction: nothing in this module imports a
  `store.ts`/`AutomationStore` write method, a marketplace connector's
  write method, or an execution pipeline.
- `profitabilityMonitor.ts`'s extended margin-crossing logic follows the
  identical "monitors observe, only automation acts" boundary every prior
  monitor has kept — it calls the pure `calculateProfitability` engine
  (via `channels.ts`) and enqueues an existing job type
  (`product_profitability_recheck`/`product_price_review`), the same as
  every other monitor since Milestone 8; it never executes a price change
  itself. `product_price_review`'s own handler (`productHandlers.ts`,
  Milestone 6–7) is unchanged — it still only *proposes* a price via
  `executePriceChange`'s existing automation-level/approval gate, which
  this milestone did not touch.
- The two real bugs fixed this milestone (`channels.ts`'s currency-default
  bug; `channelAnalytics.ts`'s currency-mixing guard) were both crash/
  correctness fixes, not security-relevant in the credential/access-control
  sense — no data was ever exposed across a currency mismatch, the failure
  mode was an uncaught exception (a 500), not an information leak.

## What Milestone 9 changed here

- Extended the read-only-history RLS pattern to four new tables
  (`exchange_rates`, `supplier_market_capabilities`,
  `market_compliance_assessments`, `market_expansion_assessments`) —
  checked in `0025_rls_global_markets.sql`.
- Extended `worker.ts`'s closed `HANDLERS` set with two more entries
  (`market_recheck`, `fx_recheck`) rather than a second dispatch mechanism
  — the "a job payload only ever supplies data to a fixed handler" rule
  above holds unchanged; neither new handler evaluates anything from a
  payload as code.
- `handleMarketRecheck` never executes an expansion decision itself — a
  `ready` recommendation only ever creates a `request_approval` action
  through the existing approval workflow (`proposeApproval.ts`, gated by
  `canApprove`/`owner` exactly as every other approval in this codebase
  is); every other outcome (`promising`/`requires_review`/`blocked`/
  `insufficient_facts`) only ever notifies, never acts. This is the same
  "monitoring/automation observes and proposes, a human or existing policy
  decides" boundary Milestone 8 established, extended to international
  expansion specifically because the brief required that a high opportunity
  score can never override a compliance failure or auto-launch a product in
  a new country.
- `fxMonitor`/`marketMonitor` follow the identical "no monitor imports a
  write method" rule as every other monitor — both call only `FxRateStore`/
  `SupplierMarketFactsLoader` read methods and the existing profitability
  engine, never a marketplace connector or an execution pipeline.
- No new credential types were introduced. `demoRates.ts` is an in-memory
  seed with no network call at all — there is no live FX provider
  credential to protect yet, and none is referenced anywhere in the new
  code.

## What Milestone 8 changed here

- Factored scheduler-secret comparison into `core/schedulerAuth.ts`, shared
  by `/api/automation/run` and the new `/api/monitoring/run`, rather than a
  second copy.
- Extended the read-only-history RLS pattern to three new tables
  (`domain_events`, `monitor_observations`, `monitor_runs`).
- Introduced a second closed-registry dispatch pattern (`MONITORS`,
  mirroring `HANDLERS`) and a second explicit mapping table
  (`EVENT_TO_JOB_MAPPING`), both reviewable and both tested for
  consistency with what the code actually does.
- No new credential types were introduced; `liveSubjects.ts` reads from the
  same Supabase tables every other server-only module already reads, via
  the same service-role client.

## What Milestone 8.5 changed here

- `liveSubjects.ts`'s discovery queries are bounded (500 rows/page, 20-page
  ceiling per monitor per run) — a denial-of-resource guard as much as a
  scale one: a single organisation's data cannot make one scheduler tick
  loop unboundedly.
- No new tables, no new RLS policies, no new credential types — every
  Milestone 8.5 query reads columns an existing migration already created
  and an existing RLS policy already governs.
- The new `supplierOperationsMonitor` reads operational figures
  (dispatch/cancellation/reliability) that no automation write path in this
  codebase produces — confirmed by inspection, not assumed — so it carries
  no new automation-loop risk (see `docs/DATABASE.md`/`docs/ARCHITECTURE.md`
  for what it does read).

## What Milestone 7 changed here

- Added `timingSafeEqual` to the scheduler secret comparison (previously
  `===`), during the Milestone 6 verification pass.
- Marketplace connector writes are gated by `descriptor.capabilities.writeListings`
  at the call site in every execution pipeline — a connector that has not
  declared write support is never called for a write, not called and told
  no.
- No new credential types were introduced; Amazon's honestly-unimplemented
  write paths (`updateListingPrice`, `updateInventory`, `setListingStatus`)
  do not read or reference a seller id that does not yet exist as a
  configured credential, rather than half-wiring one.
