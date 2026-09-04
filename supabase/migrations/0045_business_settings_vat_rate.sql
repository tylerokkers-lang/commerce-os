-- =============================================================================
-- 0045_business_settings_vat_rate.sql
-- Closes a genuine gap found auditing the economic model (see
-- HANDOVER.md): `business_settings.vat_registered` (0001) already records
-- whether a business charges VAT at all, but there has never been a column
-- for the *rate* to apply — `assemble.ts`'s profitability/pricing
-- calculation has been hardcoding vatRatePct: 0 unconditionally, which is
-- silently wrong for any VAT-registered business regardless of what
-- `vat_registered` says.
--
-- Nullable, no default — same convention as `available_operating_capital_minor`/
-- `cash_buffer_minor`/`max_supplier_cost_minor` (0037): a real VAT rate is a
-- fact about one specific business that cannot be guessed, so an unset
-- value must read as "not yet configured," never coerced to 0% or to the
-- UK standard rate. Application code is responsible for treating
-- `vat_registered = true` with `vat_rate_pct is null` as an incomplete
-- configuration, not a confirmed 0%.
--
-- Also extends `product_recommendation` (0037) with a new 'unconfigured'
-- value: the recommendation ladder must be able to say "no business
-- settings have been saved for this organisation yet" without silently
-- treating DEMO_AUTOMATION_SETTINGS' placeholder thresholds as a real
-- business decision. Added in its own statement, unused within this same
-- migration, so there is no risk of Postgres's "unsafe to use a new enum
-- value in the transaction that added it" restriction ever applying.
-- =============================================================================

alter table business_settings
  add column vat_rate_pct numeric(5,2) check (vat_rate_pct is null or (vat_rate_pct >= 0 and vat_rate_pct <= 100));

alter type product_recommendation add value 'unconfigured';
