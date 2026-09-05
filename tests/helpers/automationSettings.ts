import { DEMO_AUTOMATION_SETTINGS } from '@/lib/automation/settingsTypes'
import type { AutomationSettings } from '@/lib/automation/settingsTypes'

/**
 * A business that has genuinely saved every required business setting —
 * for tests asserting an action reaches `allow_automatic` (or is decided on
 * its own domain merits) rather than being downgraded to `require_approval`
 * purely because `businessSettingsConfigured` is false, which
 * `DEMO_AUTOMATION_SETTINGS` deliberately always is (see its own doc
 * comment in `settingsTypes.ts`).
 *
 * Introduced alongside `policyEngine.ts`'s new `business_settings_configured`
 * gate (Milestone: automation control plane) — the automation-execution
 * path now enforces the same "unknown must never be read as safe" rule
 * `resolveBusinessConfiguration` already enforced for the advisory product
 * recommendation, so any test exercising real automatic execution needs a
 * settings object that is actually configured, not merely permissive on
 * every other field.
 */
export const CONFIGURED_AUTOMATION_SETTINGS: AutomationSettings = {
  ...DEMO_AUTOMATION_SETTINGS,
  businessSettingsConfigured: true,
  automationStateKnown: true,
  vatRegistered: true,
  vatRatePct: 20,
  packagingCostMinor: 35,
  returnRatePct: 4,
  returnLossPct: 65,
  refundRatePct: 1,
  chargebackRatePct: 0.3,
  chargebackFeeMinor: 1500,
  importDutyPct: 0,
}
