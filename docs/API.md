# API

Commerce OS is a server-rendered application, not an API product — almost
every read and write happens through Server Components and Server Actions,
which are not "an API" in the REST sense and are not documented here (see
`docs/ARCHITECTURE.md`'s data-access section). This file covers the two
routes under `src/app/api/`, both plain HTTP endpoints reachable without a
browser session, because that is exactly what they are for.

## `GET|POST /api/health`

Liveness and configuration check. No authentication — it reports which
integrations are configured, never credential values.

**Response**

```json
{
  "status": "ok",
  "mode": "demo" | "live",
  "checkedAt": "2026-08-23T12:00:00.000Z",
  "integrations": [
    { "key": "shopify", "configured": false, "missingCount": 3 }
  ]
}
```

## `POST /api/automation/run` (Milestone 6–7)

The scheduled-automation entry point. A plain, stateless HTTP route with no
session and no cookies — nothing about it depends on Claude Code, ChatGPT,
or any coding assistant being open. Point any external scheduler at it: a
Vercel Cron entry, a hosted worker's timer, a serverless scheduled
function, or a `curl` line in a crontab.

Each call claims up to 10 due jobs (`automation_jobs`, across every
organisation) and runs them through the registered job-handler for their
`job_type` (`src/lib/automation/worker.ts`). See `docs/MILESTONES.md`'s
Milestone 7 section for the full list of 14 handler types.

**Authentication**: a shared secret, not a user session — required once
Supabase is configured.

```
Authorization: Bearer <AUTOMATION_CRON_SECRET>
```

Compared with `crypto.timingSafeEqual`, never `===` (see `docs/SECURITY.md`).

**Demo mode** (no Supabase configured): always returns 200 without checking
the secret, since there is no job queue to protect.

```json
{ "status": "skipped", "reason": "Demo mode has no database and no job queue to process." }
```

**Live mode, no secret configured**: refuses to run at all rather than
running unauthenticated.

```
503 { "error": "AUTOMATION_CRON_SECRET is not configured; refusing to run against a live database." }
```

**Live mode, wrong or missing secret**:

```
401 { "error": "Unauthorized" }
```

**Live mode, success**:

```json
{
  "status": "ok",
  "checkedAt": "2026-08-23T12:00:00.000Z",
  "claimed": 3,
  "succeeded": 2,
  "failed": 1,
  "deadLettered": 0
}
```

`GET` is accepted as a convenience for manual/browser checks and behaves
identically to `POST` — the scheduled call should use `POST`.

### What this route does not do

It does not accept a request body — job payloads are already persisted in
`automation_jobs` by whatever enqueued them (a job handler chaining into
another job type, or a future live event source; see
`docs/MILESTONES.md`). It cannot be used to submit new work directly, only
to process what is already queued, which is deliberate: accepting arbitrary
job definitions over HTTP would be exactly the "evaluating payload data as
code" risk `docs/SECURITY.md` documents this design as avoiding.

### Production infrastructure this route needs

Documented in full in `HANDOVER.md` §19. In short: this route existing and
working correctly (proven end to end in
`tests/automation-engine-e2e.test.ts` against a real in-memory store) is
necessary but not sufficient for 24/7 automation — something outside this
application must actually call it on a schedule, and a deployed Supabase
project is required for it to have real jobs to claim.

## `POST /api/monitoring/run` (Milestone 8)

The scheduled-monitoring entry point — upstream of `/api/automation/run`,
never a replacement for it. Same shape, same authentication, and
deliberately the same shared secret (`AUTOMATION_CRON_SECRET`), reused
rather than adding a second one, via `src/lib/core/schedulerAuth.ts`.

Each call iterates every organisation and runs whichever of the 5
registered monitors (`src/lib/monitoring/registry.ts`) are due per that
org's own configured schedule (`config_values`), via
`runDueMonitors` (`src/lib/monitoring/runner.ts`). A due monitor run loads
current facts, compares against its own last verified observation, raises
domain events on meaningful change, and enqueues automation jobs where the
`EVENT_TO_JOB_MAPPING` table says a safe one exists — this route never
performs a business action itself.

**Authentication**: identical to `/api/automation/run`.

```
Authorization: Bearer <AUTOMATION_CRON_SECRET>
```

**Demo mode**: always returns 200 without checking the secret, since there
is no monitor state to protect.

```json
{ "status": "skipped", "reason": "Demo mode has no database and no monitors to run." }
```

**Live mode, no secret configured**: refuses to run, identically to
`/api/automation/run`.

```
503 { "error": "AUTOMATION_CRON_SECRET is not configured; refusing to run against a live database." }
```

**Live mode, wrong or missing secret**:

```
401 { "error": "Unauthorized" }
```

**Live mode, success**:

```json
{
  "status": "ok",
  "checkedAt": "2026-08-24T12:00:00.000Z",
  "organisations": [
    {
      "orgId": "...",
      "monitors": [
        { "monitorKey": "supplier_stock_and_price", "ran": true, "subjectsChecked": 12, "eventsCreated": 1, "eventsDeduplicated": 0, "errors": [] },
        { "monitorKey": "marketplace_listing_sync", "ran": false, "reason": "not due", "subjectsChecked": 0, "eventsCreated": 0, "eventsDeduplicated": 0, "errors": [] }
      ]
    }
  ]
}
```

`GET` is accepted as a convenience for manual/browser checks, identically
to `/api/automation/run`.

### What this route does not do

It does not accept a request body, and it never calls a marketplace
connector's write methods, `priceExecution.ts`, or
`supplierSwitchExecution.ts` directly — monitoring observes and raises
events; only the automation engine (driven separately, by
`/api/automation/run`) decides and acts. This separation is enforced by
which modules `src/lib/monitoring/*` is allowed to import, not just by
convention.

### Production infrastructure this route needs

Documented in full in `HANDOVER.md` §21. Two enumeration gaps beyond the
standard "no external scheduler calls this yet" caveat: `liveSubjects.ts`
only has real queries for 2 of the 5 monitors (supplier stock/price and
marketplace listings), and `performanceMonitor` has no live sales
aggregation to compare against yet — both documented, not hidden.
