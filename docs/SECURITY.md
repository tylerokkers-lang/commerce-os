# Security

A review of the automation engine's security-relevant surface, written as
part of Milestone 7. This is not a certification — it is what was actually
checked, what it found, and what remains genuinely unverified because the
credentials or infrastructure to verify it do not exist in this environment.

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
pattern exactly — checked in `0020_rls_automation_engine.sql`.

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

`POST /api/automation/run` has no user session — a scheduler is not a
logged-in owner. It is authenticated by a shared secret
(`AUTOMATION_CRON_SECRET`) compared with `crypto.timingSafeEqual`, not `===`,
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
