-- =============================================================================
-- 0019_automation_engine.sql
-- Milestone 6: automation engine.
--
-- `ai_decisions` (approval requests), `automation_rules` (configurable
-- per-capability toggles) and `automation_runs` (a log of completed
-- scheduler runs) already exist from 0008 and were unused until now — this
-- migration does not duplicate any of them. What is genuinely new:
--
--   - `automation_actions`: the fact-first record of one automation decision
--     and its execution, per `docs/PRINCIPLES.md` FACTS -> RULES -> DECISION
--     -> POLICY CHECK -> AUTOMATION LEVEL -> ACTION -> VERIFICATION -> AUDIT.
--     Distinct from `audit_logs` (a generic append-only ledger every module
--     writes to) and from `ai_decisions` (an approval *request*, not
--     necessarily automation-originated) — this is specifically "what did the
--     automation engine decide, on what facts, under what policy, and what
--     happened when it acted."
--   - `automation_jobs`: an application-level scheduled/retryable job queue,
--     because the brief requires automation that keeps running without
--     Claude Code, ChatGPT or any coding assistant open. `automation_runs`
--     already records a run's *outcome* once it has happened; this table is
--     what makes a run happen on a schedule, exactly once, with retries.
--   - A handful of new `business_settings` columns: the kill switch, the
--     category-level pause list, and financial limits Milestone 5 did not
--     yet need (daily refund/supplier-spend ceilings, per-order refund count,
--     max daily price movement, max supplier-switch cost increase).
--   - `risk_level` and `action_payload` on `ai_decisions`, so an approval
--     records what it would execute and how risky it is, not only why it was
--     proposed. `action_payload` exists specifically so approving a decision
--     executes the *exact* thing that was proposed rather than a silently
--     recalculated one (§18 of the brief).
-- =============================================================================

create type automation_action_type as enum (
  'update_inventory', 'update_price', 'pause_product', 'resume_product',
  'publish_product', 'unpublish_product', 'switch_supplier',
  'submit_supplier_order', 'update_fulfilment', 'update_tracking',
  'process_refund', 'cancel_order', 'request_approval',
  'reconcile_marketplace', 'reconcile_supplier', 'alert_owner'
);

create type automation_action_status as enum (
  'pending', 'executing', 'succeeded', 'failed', 'blocked',
  'requires_approval', 'retry_pending', 'stale_facts', 'cancelled'
);

create type automation_risk_level as enum ('low', 'medium', 'high', 'unknown');

create type automation_job_status as enum (
  'pending', 'running', 'succeeded', 'failed', 'dead_letter', 'cancelled'
);

-- -----------------------------------------------------------------------------
-- Kill switch, category pauses, and the financial limits Milestone 5 left out
-- -----------------------------------------------------------------------------

alter table business_settings
  add column automation_paused boolean not null default false,
  add column automation_paused_at timestamptz,
  add column automation_paused_reason text,
  -- One of: 'publishing', 'pricing', 'supplier_switching', 'supplier_ordering',
  -- 'refunds', 'fulfilment'. Enforced in application code (`automation/policyEngine.ts`)
  -- rather than a check constraint, so a new category never needs a migration.
  add column automation_paused_categories text[] not null default '{}',
  add column max_daily_auto_refund_minor bigint not null default 20000,        -- £200/day
  add column max_refunds_per_order int not null default 3,
  add column max_daily_auto_supplier_spend_minor bigint not null default 100000, -- £1,000/day
  add column max_auto_supplier_switch_cost_increase_pct numeric(5,2) not null default 10.00,
  add column max_price_movement_per_day_pct numeric(5,2) not null default 10.00;

alter table ai_decisions
  add column risk_level automation_risk_level not null default 'low',
  -- The exact action the system would take if approved, captured at proposal
  -- time. Approving a decision replays this verbatim (see
  -- `automation/approvalWorkflow.ts`); it is never recomputed from scratch,
  -- so an approval cannot silently authorise a different action than the one
  -- the owner actually saw.
  add column action_payload jsonb not null default '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- automation_actions — the fact-first record of a decision and its execution
-- -----------------------------------------------------------------------------

create table automation_actions (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organisations(id) on delete cascade,

  -- Ties every action, job and audit entry from one workflow together, even
  -- across a switch -> approval -> execution chain spanning multiple rows.
  correlation_id uuid not null default gen_random_uuid(),
  -- Set only for actions where the caller can guarantee the same real-world
  -- action was requested (e.g. "switch supplier for product X because of
  -- event Y"), so a duplicated event never produces a duplicated action.
  idempotency_key text,

  action_type automation_action_type not null,
  entity_type text not null,
  entity_id   text,

  reason       text not null,
  input_facts  jsonb not null default '{}'::jsonb,
  decision     jsonb not null default '{}'::jsonb,
  policy_result jsonb not null default '{}'::jsonb,

  automation_level automation_level not null,
  risk_level       automation_risk_level not null default 'low',
  expected_outcome text,

  status automation_action_status not null default 'pending',
  error  text,

  actor_type actor_type not null default 'system',
  ai_decision_id uuid references ai_decisions(id) on delete set null,
  job_id uuid,

  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz,

  unique (org_id, idempotency_key)
);

create index automation_actions_org_status_idx on automation_actions(org_id, status, created_at desc);
create index automation_actions_org_type_idx on automation_actions(org_id, action_type, created_at desc);
create index automation_actions_entity_idx on automation_actions(org_id, entity_type, entity_id);
create index automation_actions_correlation_idx on automation_actions(correlation_id);

-- -----------------------------------------------------------------------------
-- automation_jobs — the application-level scheduler queue
--
-- This is what lets automation run without any AI coding tool open: a plain
-- HTTP route (`/api/automation/run`), triggered by an external scheduler
-- (cron, a hosted worker, a serverless scheduled function — whatever the
-- owner's production host provides), claims due jobs from this table and
-- executes them. Nothing about the claim/execute/complete cycle depends on
-- who or what calls that route.
-- -----------------------------------------------------------------------------

create table automation_jobs (
  id     uuid primary key default gen_random_uuid(),
  org_id uuid not null references organisations(id) on delete cascade,

  job_type text not null,          -- 'product_monitor_sweep' | 'process_pending_action' | ...
  status   automation_job_status not null default 'pending',
  payload  jsonb not null default '{}'::jsonb,

  run_at   timestamptz not null default now(),  -- delayed/scheduled jobs are not due before this
  idempotency_key text,

  attempts     int not null default 0,
  max_attempts int not null default 5,
  last_error   text,

  -- Claim fields: a worker sets both when it picks the job up, and a claim
  -- older than a lock timeout (enforced in `automation/jobs.ts`, not here) is
  -- treated as abandoned rather than trusted forever, so a crashed worker
  -- cannot strand a job in `running` permanently.
  locked_at timestamptz,
  locked_by text,

  correlation_id uuid not null default gen_random_uuid(),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,

  unique (org_id, idempotency_key)
);

create index automation_jobs_claim_idx on automation_jobs(status, run_at);
create index automation_jobs_org_idx on automation_jobs(org_id, created_at desc);

create trigger automation_jobs_touch before update on automation_jobs
  for each row execute function touch_updated_at();

alter table automation_actions
  add constraint automation_actions_job_fk
  foreign key (job_id) references automation_jobs(id) on delete set null;
