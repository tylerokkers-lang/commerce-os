-- =============================================================================
-- 0029_system_maintenance_runs.sql
-- Cross-organisation maintenance run tracking (Milestone 18).
--
-- `automation_runs` (migration 0008) already exists as "a log of completed
-- scheduler runs" (0019's own comment) but has never been written to by any
-- application code — reserved, exactly like `automation_action_status`'s
-- `retry_pending` value was before Milestone 17. Its shape already fits
-- this milestone's need almost exactly: `job_key`/`status`/`started_at`/
-- `finished_at`/`duration_ms`/`items_processed`/`items_failed`/
-- `decisions_created`/`error`/`summary` (jsonb) is precisely the run
-- history Phase 6/9/10 ask for. No new table is created.
--
-- The one real gap: `org_id` is `not null`, and every existing use this
-- table was designed for is a per-organisation job (a daily report, an
-- inventory sync). The maintenance orchestrator (`/api/automation/maintenance`)
-- is genuinely cross-organisation — recovery and campaign monitoring both
-- already iterate every connected org internally — so it has no single
-- owning organisation to attribute a row to. Forcing an arbitrary real
-- org's id onto it would misattribute the run in every other place that
-- reads `automation_runs` by `org_id`. `org_id` becomes nullable
-- specifically for this class of system-level job; every existing
-- per-org use of the table is completely unaffected (a `not null`
-- column made nullable never invalidates existing non-null data, and
-- there are zero existing rows in this never-used table regardless).
--
-- RLS (migration 0009) already reads `using (org_id in (select
-- auth_org_ids()))` — a row with `org_id is null` evaluates that
-- predicate to `null` (neither true nor false) under standard SQL
-- three-valued logic, so it is automatically invisible to every ordinary,
-- org-scoped session without any policy change. Only the service role
-- (which bypasses RLS entirely, exactly like every other system-level
-- write in this codebase) can read or write a system-level run.
--
-- The partial unique index below is the single-run lock Phase 4/5 need:
-- at most one row with a given `job_key` and `org_id is null` may be
-- `status = 'running'` at a time. Acquiring the lock is a plain `insert
-- ... status: 'running'`; Postgres itself rejects a second concurrent
-- insert for the same `job_key` while one is still running, which is
-- what makes this safe across multiple server processes/instances, not
-- only within one process's memory (Phase 4's explicit requirement). A
-- row that finishes (`status` moves to `success`/`failed`/`partial_success`)
-- immediately drops out of the partial index's scope, so the lock is
-- available again — no separate "unlock" step beyond the normal
-- terminal-status update every run already needs to make.
-- =============================================================================

alter table automation_runs
  alter column org_id drop not null;

comment on column automation_runs.org_id is
  'Null for system-level, cross-organisation jobs (e.g. automation_maintenance) that have no single owning organisation. Every per-org job (inventory_sync, daily_report, ...) keeps a real org_id as before.';

create unique index automation_runs_active_system_lock_idx
  on automation_runs (job_key)
  where org_id is null and status = 'running';
