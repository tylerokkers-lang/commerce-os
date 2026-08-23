-- =============================================================================
-- 0021_external_action_verification.sql
-- Milestone 7: production automation & real execution.
--
-- "A successful submission is not the same as a verified result" (brief §10)
-- is implemented as two new columns on the existing `automation_actions`
-- table rather than a parallel state-machine table — `docs/PRINCIPLES.md`
-- and this milestone's own brief are both explicit that redundant state
-- systems must not be created. `automation_actions.status` already
-- distinguishes pending/executing/succeeded/failed/blocked/etc (Milestone 6);
-- these columns add the missing distinction *within* "executing": has the
-- external write been submitted, and has its result actually been verified
-- against the provider's own state, rather than assumed from a 200 response.
--
--   verification_status: not_applicable (no external call was made — a pure
--     internal decision like a supplier switch) | pending (submitted, not
--     yet checked) | verified (checked and matches) | failed (checked and
--     does not match, or the provider rejected it) | uncertain (the
--     provider's response was lost — a timeout, a dropped connection — so
--     neither success nor failure is known; never treated as either).
--   reconciliation_status: not_applicable | matched (local state agrees
--     with the provider's) | discrepancy (recorded, never silently
--     resolved, same as `channel_discrepancies` from Milestone 4) | pending.
--   external_ref: the provider's own id for the thing this action touched
--     (a Shopify fulfillment id, an Amazon order id) — required to verify
--     or reconcile anything, and the anchor an idempotent retry checks
--     before ever re-submitting.
-- =============================================================================

alter table automation_actions
  add column external_ref text,
  add column verification_status text not null default 'not_applicable'
    check (verification_status in ('not_applicable', 'pending', 'verified', 'failed', 'uncertain')),
  add column reconciliation_status text not null default 'not_applicable'
    check (reconciliation_status in ('not_applicable', 'matched', 'discrepancy', 'pending'));

create index automation_actions_verification_idx
  on automation_actions(org_id, verification_status)
  where verification_status in ('pending', 'uncertain');
