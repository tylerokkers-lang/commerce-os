-- Milestone: execution reliability & unified write path — circuit breaker
-- enforcement. Both tables already carried the columns this needs
-- (supplier_connectors: 0013; channels: 0005/0015) but nothing ever wrote
-- to them. These two functions are the ONLY way an outcome is recorded —
-- a single atomic statement each, so two concurrent workers recording a
-- failure for the same connector at the same instant both apply correctly
-- (Postgres serialises row-level UPDATE/INSERT..ON CONFLICT internally;
-- there is no read-modify-write race here for the increment itself).
--
-- `supplier_connectors` genuinely has zero rows in production today (no
-- application code has ever inserted one) — the upsert's INSERT branch is
-- what lets a connector's very first recorded outcome create its own
-- tracking row, using real values the caller already has in hand
-- (its own descriptor's label/source_type/rate limit), never guessed
-- defaults invented by this function.

create or replace function record_supplier_connector_outcome(
  p_org_id uuid,
  p_supplier_id uuid,
  p_connector_key text,
  p_label text,
  p_source_type connector_source_type,
  p_min_seconds_between_runs int,
  p_succeeded boolean,
  p_error text,
  p_next_allowed_at timestamptz,
  p_consecutive_failures int
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into supplier_connectors (
    org_id, supplier_id, connector_key, label, source_type,
    status, is_enabled, min_seconds_between_runs,
    last_success_at, last_failure_at, last_error, next_allowed_at, consecutive_failures
  )
  values (
    p_org_id, p_supplier_id, p_connector_key, p_label, p_source_type,
    case when p_succeeded then 'connected' else 'error' end, true, p_min_seconds_between_runs,
    case when p_succeeded then now() else null end,
    case when p_succeeded then null else now() end,
    p_error, p_next_allowed_at, p_consecutive_failures
  )
  on conflict (org_id, supplier_id, connector_key) do update
  set
    status = case when p_succeeded then 'connected' else 'error' end,
    last_success_at = case when p_succeeded then now() else supplier_connectors.last_success_at end,
    last_failure_at = case when p_succeeded then supplier_connectors.last_failure_at else now() end,
    last_error = case when p_succeeded then supplier_connectors.last_error else p_error end,
    next_allowed_at = p_next_allowed_at,
    consecutive_failures = p_consecutive_failures,
    updated_at = now();
end;
$$;

create or replace function record_marketplace_connector_outcome(
  p_org_id uuid,
  p_channel_key channel_key,
  p_succeeded boolean,
  p_error text,
  p_next_allowed_at timestamptz,
  p_consecutive_failures int
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update channels
  set
    last_success_at = case when p_succeeded then now() else last_success_at end,
    last_failure_at = case when p_succeeded then last_failure_at else now() end,
    last_error = case when p_succeeded then last_error else p_error end,
    next_retry_at = p_next_allowed_at,
    consecutive_failures = p_consecutive_failures,
    updated_at = now()
  where org_id = p_org_id and key = p_channel_key;
end;
$$;
