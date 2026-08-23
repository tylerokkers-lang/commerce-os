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
be a history.

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
