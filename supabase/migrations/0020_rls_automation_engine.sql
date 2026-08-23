-- =============================================================================
-- 0020_rls_automation_engine.sql
-- Row level security for the tables added in 0019.
--
-- Same model as `ai_decisions` and `automation_runs` in 0009: read-only
-- through RLS for every org member, written only by the service role from
-- server-side code (`automation/actions.ts`, `automation/jobs.ts`,
-- `automation/approvalWorkflow.ts`). This is deliberate, not an oversight —
-- an automation action or a queued job must never be creatable or editable
-- by a direct client write, only by the engine itself.
-- =============================================================================

do $$
declare
  t text;
  managed_tables constant text[] := array[
    'automation_actions', 'automation_jobs'
  ];
begin
  foreach t in array managed_tables loop
    execute format('alter table %I enable row level security', t);

    execute format(
      'create policy %I on %I for select using (org_id in (select auth_org_ids()))',
      t || '_read', t
    );
  end loop;
end;
$$;
