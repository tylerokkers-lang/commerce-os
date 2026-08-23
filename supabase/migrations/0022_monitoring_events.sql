-- =============================================================================
-- 0022_monitoring_events.sql
-- Milestone 8: continuous intelligence, monitoring & event generation.
--
-- Three new tables, deliberately minimal against what already exists:
--
--   - `domain_events`: the fact-first record of "something changed" —
--     OPEN/PROCESSING/PROCESSED/IGNORED/SUPERSEDED/FAILED, exactly the
--     lifecycle the brief specifies. Deduplication is enforced by a partial
--     unique index on `(org_id, dedupe_key)` where `status = 'open'` — the
--     same "the database constraint is the actual guarantee" pattern
--     `automation_actions`/`automation_jobs` already use for idempotency
--     (Milestone 6), not a check reimplemented in application code.
--   - `monitor_observations`: the "previous verified fact" a monitor
--     compares its current reading against — a small mutable cursor per
--     (monitor, subject), not history. `domain_events` is the history;
--     this is only ever the latest known value, upserted on every check.
--   - `monitor_runs`: one row per scheduler-triggered execution of one
--     monitor, mirroring `automation_runs` (Milestone 1, never used until
--     now) in shape but with the specific counters the brief asks for.
--
-- Monitor *schedule configuration* (interval per monitor type) deliberately
-- does not get a new table — it reuses `config_values` (Milestone 1's
-- generic, versioned key/value store), exactly the brief's "store schedule
-- configuration in an appropriate configuration system" instruction. A
-- schedule is `config_values` row with key `monitor_schedule:<monitor_key>`.
-- =============================================================================

create type event_status as enum ('open', 'processing', 'processed', 'ignored', 'superseded', 'failed');
create type event_severity as enum ('info', 'warning', 'critical');
create type monitor_run_status as enum ('running', 'success', 'partial_success', 'failed', 'cancelled');

create table domain_events (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,

  event_type   text not null,
  subject_type text not null,
  subject_id   text,

  -- Whether this fact was observed locally (our own database) or from the
  -- external platform (a marketplace/supplier API) — the brief is explicit
  -- that these must never be conflated, and that external facts take
  -- precedence when reconciling. 'internal' covers events raised by the
  -- automation engine itself (e.g. a completed execution) rather than by
  -- any external observation.
  source              text not null check (source in ('local', 'external', 'internal')),
  source_connector_key text,
  source_observation_id text,

  occurred_at timestamptz not null default now(),
  detected_at timestamptz not null default now(),

  severity event_severity not null default 'info',

  previous_value jsonb,
  current_value  jsonb,
  facts          jsonb not null default '{}'::jsonb,
  metadata       jsonb not null default '{}'::jsonb,

  -- Enforces "one open condition, not one row per monitor tick" at the
  -- database level (see the partial unique index below).
  dedupe_key text,

  -- Loop prevention (brief's worked example: a price change we made
  -- ourselves must never be re-observed as an external change and acted on
  -- again). `correlation_id` threads one whole observe->event->job->action
  -- chain together; `causation_id` points at the specific event (if any)
  -- whose automation action caused *this* observation, so a monitor can
  -- recognise "this looks like my own last write" rather than treating it
  -- as fresh external signal.
  correlation_id uuid not null default gen_random_uuid(),
  causation_id   uuid references domain_events(id) on delete set null,

  status event_status not null default 'open',
  automation_job_id uuid references automation_jobs(id) on delete set null,
  superseded_by     uuid references domain_events(id) on delete set null,

  monitor_run_id uuid,

  is_demo    boolean not null default false,
  -- (monitor_run_id -> monitor_runs.id FK added below, after that table exists)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The actual deduplication guarantee: two monitor ticks that both observe
-- the same still-ongoing condition cannot both create a new OPEN event for
-- it, full stop, regardless of how many workers or how many ticks run
-- concurrently.
create unique index domain_events_open_dedupe_idx
  on domain_events(org_id, dedupe_key)
  where status = 'open' and dedupe_key is not null;

create index domain_events_org_status_idx on domain_events(org_id, status, detected_at desc);
create index domain_events_org_subject_idx on domain_events(org_id, subject_type, subject_id);
create index domain_events_org_type_idx on domain_events(org_id, event_type, detected_at desc);

create trigger domain_events_touch before update on domain_events
  for each row execute function touch_updated_at();

-- -----------------------------------------------------------------------------
-- monitor_observations — the "previous verified fact" a monitor compares
-- its current reading against. Mutable by design (it is a cursor, not
-- history); `domain_events` is where the actual change history lives.
-- -----------------------------------------------------------------------------

create table monitor_observations (
  org_id       uuid not null references organisations(id) on delete cascade,
  monitor_key  text not null,
  subject_type text not null,
  subject_id   text not null,

  -- 'ok' | 'unavailable' | 'unknown' — an observation that could not be
  -- made (a failed connector, missing data) is recorded as such, never
  -- silently defaulted to the last-known 'ok' value.
  status text not null default 'unknown' check (status in ('ok', 'unavailable', 'unknown')),
  value  jsonb not null default '{}'::jsonb,

  last_checked_at timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  primary key (org_id, monitor_key, subject_type, subject_id)
);

create trigger monitor_observations_touch before update on monitor_observations
  for each row execute function touch_updated_at();

-- -----------------------------------------------------------------------------
-- monitor_runs — one row per scheduler-triggered execution of one monitor.
-- -----------------------------------------------------------------------------

create table monitor_runs (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,

  monitor_key text not null,
  status      monitor_run_status not null default 'running',

  started_at   timestamptz not null default now(),
  completed_at timestamptz,

  subjects_checked      int not null default 0,
  observations_created  int not null default 0,
  events_created        int not null default 0,
  events_deduplicated   int not null default 0,

  error text,
  next_scheduled_at timestamptz,

  -- The same claim pattern as `automation_jobs` (Milestone 6): a worker
  -- claims a due monitor with an atomic `UPDATE ... WHERE status = 'running'
  -- AND locked_by IS NULL`-shaped write, not a second locking mechanism.
  locked_by text,
  locked_at timestamptz,

  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index monitor_runs_org_key_idx on monitor_runs(org_id, monitor_key, started_at desc);

alter table domain_events
  add constraint domain_events_monitor_run_fk
  foreign key (monitor_run_id) references monitor_runs(id) on delete set null;
