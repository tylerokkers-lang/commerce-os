-- =============================================================================
-- 0047_business_settings_cost_model.sql
-- Closes four remaining "unknown ≠ zero" gaps found auditing the economic
-- model: packaging, returns/refunds, chargebacks and import duty were
-- either not represented in `business_settings` at all, or (returns/
-- refunds) already supported by `calculateProfitability`'s own
-- `CostInputs` but never exposed as an organisation setting, so
-- `assemble.ts` could never pass anything but an implicit, silent 0.
--
-- Every column here is nullable, no default — same convention as
-- `available_operating_capital_minor`/`cash_buffer_minor`/
-- `max_supplier_cost_minor` (0037) and `vat_rate_pct` (0045): a real
-- business assumption that cannot be guessed, so an unset value must read
-- as "not yet decided," never coerced to 0 or to a demo figure. This is
-- deliberate even for the four fields the application layer treats as
-- *required* for a fully "configured" business profile (return/refund/
-- chargeback rates, import duty) — the schema itself must never be able
-- to vend a wrong number, even if some future code path bypassed the
-- settings form; "required" is enforced by `businessSettingsSchema` (zod)
-- and `resolveBusinessConfiguration()`, not by a NOT NULL default.
--
-- `packaging_cost_minor` is the one OPTIONAL field of the four (see
-- HANDOVER.md for the reasoning): dropshipping's normal case is that the
-- supplier packages the item directly, so a genuinely unset value here
-- does not, by itself, block calling a product's economics "configured" —
-- but it is still never silently read as £0 in a calculation; the
-- breakdown always distinguishes "not configured" from a confirmed zero.
--
-- All money columns follow this table's own existing convention
-- (`max_auto_purchase_minor` etc.): minor units in the organisation's home
-- currency (GBP), no separate currency column, matching every other money
-- field already on this table.
-- =============================================================================

alter table business_settings
  add column packaging_cost_minor bigint check (packaging_cost_minor is null or packaging_cost_minor >= 0),
  add column return_rate_pct numeric(5,2) check (return_rate_pct is null or (return_rate_pct >= 0 and return_rate_pct <= 100)),
  add column return_loss_pct numeric(5,2) check (return_loss_pct is null or (return_loss_pct >= 0 and return_loss_pct <= 100)),
  add column refund_rate_pct numeric(5,2) check (refund_rate_pct is null or (refund_rate_pct >= 0 and refund_rate_pct <= 100)),
  add column chargeback_rate_pct numeric(5,2) check (chargeback_rate_pct is null or (chargeback_rate_pct >= 0 and chargeback_rate_pct <= 100)),
  add column chargeback_fee_minor bigint check (chargeback_fee_minor is null or chargeback_fee_minor >= 0),
  add column import_duty_pct numeric(5,2) check (import_duty_pct is null or (import_duty_pct >= 0 and import_duty_pct <= 100));
