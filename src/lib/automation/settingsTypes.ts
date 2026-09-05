import type { AutomationCategory, AutomationLevel } from './types'

/**
 * The automation policy engine's configuration, read from `business_settings`
 * (extended in migration 0019). Kept in its own file with no `server-only`
 * import — unlike the database read in `settings.ts` — specifically so
 * `policyEngine.ts` and its unit tests can use `isCategoryPaused` without
 * pulling in a module that only works inside a server request.
 */
export interface AutomationSettings {
  automationLevel: AutomationLevel
  automationPaused: boolean
  automationPausedAt: string | null
  automationPausedReason: string | null
  automationPausedCategories: readonly AutomationCategory[]
  maxAutoPurchaseMinor: number
  maxAutoPriceChangePct: number
  maxPriceMovementPerDayPct: number
  maxAutoRefundMinor: number
  maxDailyAutoRefundMinor: number
  maxRefundsPerOrder: number
  maxDailyAutoSupplierSpendMinor: number
  maxAutoSupplierSwitchCostIncreasePct: number
  minNetMarginPct: number
  /**
   * Milestone 14 — `business_settings.max_daily_ad_spend_minor`/`min_roas`
   * have existed since Milestone 1 (the Settings page already edits them,
   * `products/settings.ts`'s `businessSettingsSchema` already validates
   * them) but were never read by any analysis code until now — wired in
   * here rather than a second settings read, matching how every other
   * threshold in this file is already read once, in one place.
   */
  maxDailyAdSpendMinor: number
  minRoas: number
  /**
   * Milestone 15 — `business_settings.max_auto_ad_increase_pct` has existed
   * since Milestone 1 (reserved for exactly this) but was never read
   * anywhere until now. Bounds the *magnitude* of an automatic campaign
   * budget change symmetrically — the same `Math.abs(actualPct) <=
   * limitPct` rule `policyEngine.ts`'s `percentageRequirement` already
   * applies to `maxAutoPriceChangePct`, reused unchanged rather than a
   * second, decrease-specific column: a budget decrease is the inherently
   * safer direction, so the one configured magnitude limit is what needs
   * enforcing on both directions, not a fabricated second threshold.
   */
  maxAutoAdIncreasePct: number
  /**
   * Milestone: product intelligence (Phase 4). `min_gross_margin_pct` and
   * `min_opportunity_score` have existed on `business_settings` since 0001
   * (reserved for exactly this) but were never read by any analysis code
   * until now — the same "wire in something that already existed" pattern
   * as `maxDailyAdSpendMinor`/`maxAutoAdIncreasePct` above.
   */
  minGrossMarginPct: number
  minOpportunityScore: number
  /** New this milestone (0037) — see that migration for why each is nullable. */
  minQualityScore: number
  maxRiskScore: number
  targetNetMarginPct: number
  advertisingAllowancePct: number
  /** Cash actually available to fund supplier purchases — null until the owner sets it. Never assumed unlimited or zero. */
  availableOperatingCapitalMinor: number | null
  /** Reserve that capital-efficiency calculations must never treat as spendable. */
  cashBufferMinor: number | null
  /** A hard ceiling on supplier unit cost, if the owner has set one. Null means no ceiling is configured. */
  maxSupplierCostMinor: number | null
  /** Milestone: supplier discovery (Phase 5). Bounds a single discovery pass — quality over catalogue size, per the brief. */
  maxCandidatesPerDiscoveryRun: number
  /** Ceiling on how many candidates may sit at 'new'/'duplicate' awaiting a human decision before further capture is refused. */
  maxProductsPendingReview: number
  /** Milestone: controlled Shopify publication (Phase 6). Below this, the Shopify eligibility gate blocks on "Missing product images." */
  minProductImages: number
  /** Milestone: product media intelligence (Phase 7). Deterministic resolution/format/size thresholds — never hard-coded in the quality engine itself. */
  minImageWidthPx: number
  minImageHeightPx: number
  maxImageFileSizeBytes: number
  allowedImageFormats: readonly string[]
  /**
   * Milestone: real supplier connector (Phase 8). An existing
   * `business_settings` column (Milestone 1, editable in Settings since
   * "Maximum delivery time (days)") wired into a live decision for the
   * first time here — `shippingPolicy.ts`'s deterministic gate rejects a
   * supplier whose fastest confirmed delivery estimate exceeds this,
   * rather than a second, duplicate threshold being invented.
   */
  maxDeliveryDays: number
  /**
   * Milestone: business-settings configuration layer. Whether a real
   * `business_settings` row exists for this organisation — `false` only
   * when this object is `DEMO_AUTOMATION_SETTINGS` itself (no row found,
   * or a demo session). Every numeric field above still carries a real
   * number in that case (so profitability/pricing/quality/risk/opportunity
   * can still compute something informative to show), but callers making a
   * genuine business decision (recommendation/eligibility) must treat
   * those numbers as unconfirmed placeholders, never a real business
   * decision, while this is `false`.
   */
  businessSettingsConfigured: boolean
  /**
   * Milestone: automation control plane. `true` whenever this object
   * reflects a genuine, successfully-read state — a real `business_settings`
   * row, OR the demo constant below (demo is a deliberately sandboxed,
   * known state, not an unknown one; nothing in demo mode ever reaches a
   * real external write regardless of this flag). `false` only for the one
   * case that must never be read as "not paused": a live organisation whose
   * `business_settings` row could not be confirmed to exist. The kill switch
   * (`policyEngine.ts`) fails closed on this — an action never reaches
   * `allow_automatic` while this is `false`, no matter what the domain
   * engine or `automationPaused` itself say, because "unknown" must never be
   * read as "known to be safe."
   */
  automationStateKnown: boolean
  /** Existing since 0001 (`business_settings.vat_registered`), never read outside invoicing until now. */
  vatRegistered: boolean
  /**
   * The rate to apply for profitability/pricing estimation (0045) —
   * distinct from `vatRegistered`: a business can be registered with no
   * rate configured yet (nothing here guesses the UK standard rate or any
   * other). `null` means genuinely not configured; callers must not
   * silently substitute 0 and present the result as a confirmed VAT
   * treatment when `vatRegistered` is true.
   */
  vatRatePct: number | null
  /**
   * Milestone: economic-model cost completeness (0047). The dropshipping
   * norm is that the supplier packages the item directly, so this is the
   * one optional field of the four added this milestone — `null` never
   * blocks `resolveBusinessConfiguration`'s `configured` verdict, but is
   * still never silently read as £0 in a calculation; the profitability
   * breakdown always distinguishes "not configured" from a confirmed
   * zero (see `profitability/index.ts`'s breakdown lines).
   */
  packagingCostMinor: number | null
  /** Expected fraction of orders returned. Required for a fully "configured" business profile — a real, material assumption Product Intelligence cannot honestly omit. */
  returnRatePct: number | null
  /** Portion of a returned unit's cost that is unrecoverable, 0-100. */
  returnLossPct: number | null
  /** Expected refunds as a percentage of revenue, beyond returns. */
  refundRatePct: number | null
  /** Expected fraction of orders resulting in a card chargeback. */
  chargebackRatePct: number | null
  /** The card network/processor's fixed dispute fee per chargeback event. */
  chargebackFeeMinor: number | null
  /**
   * A conservative, operator-chosen import duty assumption (percentage of
   * landed supplier cost) — deliberately not a real customs calculator
   * (no HS-code/origin/destination modelling exists or is claimed here).
   * `0` is a legitimate, explicit choice ("duty does not apply to this
   * business"); `null` means the business has not yet decided.
   */
  importDutyPct: number | null
}

/**
 * Cautious starting values for a new business — deliberately conservative,
 * matching the migration's own column defaults and `settings/page.tsx`'s
 * `DEMO_DEFAULTS` where the field overlaps.
 */
export const DEMO_AUTOMATION_SETTINGS: AutomationSettings = {
  automationLevel: 'assisted',
  automationPaused: false,
  automationPausedAt: null,
  automationPausedReason: null,
  automationPausedCategories: [],
  maxAutoPurchaseMinor: 20000,
  maxAutoPriceChangePct: 5,
  maxPriceMovementPerDayPct: 10,
  maxAutoRefundMinor: 5000,
  maxDailyAutoRefundMinor: 20000,
  maxRefundsPerOrder: 3,
  maxDailyAutoSupplierSpendMinor: 100000,
  maxAutoSupplierSwitchCostIncreasePct: 10,
  minNetMarginPct: 10,
  maxDailyAdSpendMinor: 5000, // Matches business_settings' own column default (£50).
  minRoas: 3,
  maxAutoAdIncreasePct: 20,
  minGrossMarginPct: 25,
  minOpportunityScore: 70,
  minQualityScore: 60,
  maxRiskScore: 70,
  targetNetMarginPct: 35,
  advertisingAllowancePct: 15,
  // Demo mode has no real business behind it, so these stay unconfigured —
  // exactly the honest state a brand-new live org starts in too.
  availableOperatingCapitalMinor: null,
  cashBufferMinor: null,
  maxSupplierCostMinor: null,
  maxCandidatesPerDiscoveryRun: 20,
  maxProductsPendingReview: 50,
  minProductImages: 1,
  minImageWidthPx: 800,
  minImageHeightPx: 800,
  maxImageFileSizeBytes: 5242880,
  allowedImageFormats: ['jpeg', 'png', 'webp'],
  maxDeliveryDays: 7,
  // This is the tell: every field above is a placeholder, not a business
  // decision, until a real business_settings row exists. See settings.ts —
  // this constant is only ever returned when no row was found (or a demo
  // session), and callers making a genuine recommendation/eligibility
  // decision must check this before trusting the numbers above.
  businessSettingsConfigured: false,
  // Demo is a deliberately known, sandboxed state — see the field's own doc comment.
  automationStateKnown: true,
  vatRegistered: false,
  vatRatePct: null,
  packagingCostMinor: null,
  returnRatePct: null,
  returnLossPct: null,
  refundRatePct: null,
  chargebackRatePct: null,
  chargebackFeeMinor: null,
  importDutyPct: null,
}

/**
 * Milestone: automation control plane. Returned only for a LIVE
 * organisation whose `business_settings` row could not be confirmed to
 * exist (`settings.ts`'s `!data` branch) — never for a demo session, which
 * has its own, separately-known constant above. Deliberately not just
 * `{ ...DEMO_AUTOMATION_SETTINGS, automationStateKnown: false }` inline at
 * each call site: `automationPaused: true` here is a second, independent
 * layer of the same fail-closed guarantee `policyEngine.ts`'s explicit
 * `automationStateKnown` check already provides, so the kill switch reads
 * as "paused" even if a future caller reads `automationPaused` directly
 * without going through the policy engine at all.
 */
export const UNKNOWN_STATE_AUTOMATION_SETTINGS: AutomationSettings = {
  ...DEMO_AUTOMATION_SETTINGS,
  automationPaused: true,
  automationPausedReason: 'Automation state is unknown for this organisation — no business settings row was found. Autonomous actions are refused until business settings are saved.',
  automationStateKnown: false,
}

/** Whether the kill switch (global or category-specific) currently blocks an action. */
export function isCategoryPaused(settings: AutomationSettings, category: AutomationCategory | null): boolean {
  if (settings.automationPaused) return true
  if (category === null) return false
  return settings.automationPausedCategories.includes(category)
}

export interface BusinessConfigurationStatus {
  /**
   * `true` only when a real `business_settings` row exists for this org
   * AND every field genuinely *required* for a trustworthy recommendation
   * has a real value — VAT rate (if registered), return/refund rate,
   * return loss, chargeback rate/fee, and import duty. Packaging is
   * deliberately excluded from this check (see `packagingConfigured`
   * below) — the dropshipping norm is the supplier packages the item
   * directly, so its absence alone must not permanently block
   * "configured." Everything downstream that would otherwise call a
   * product a "candidate"/"strong candidate" must check `configured`
   * first.
   */
  configured: boolean
  /** Human-readable reasons `configured` is `false` — empty when it's `true`. Surfaced in the UI/recommendation reason so an operator is told exactly what is still missing, never just "no." */
  missingRequired: readonly string[]
  /**
   * Real numbers for the calculation engines to run against regardless —
   * 0 for "not registered"/"not applicable" (a confirmed fact once
   * `configured` is true) or for "not yet known" (a placeholder, never
   * presented as final). Callers must use `configured` (or, for
   * packaging, `packagingConfigured`) to decide whether a figure is a
   * business decision or a provisional placeholder — never infer that
   * from the number itself.
   */
  effectiveVatRatePct: number
  effectivePackagingCostMinor: number
  effectiveReturnRatePct: number
  effectiveReturnLossPct: number
  effectiveRefundRatePct: number
  effectiveChargebackRatePct: number
  effectiveChargebackFeeMinor: number
  effectiveImportDutyPct: number
  /** `true` only when the operator has explicitly set a packaging cost (including an explicit £0) — distinct from `configured`, since packaging alone never blocks it. */
  packagingConfigured: boolean
}

/**
 * Milestone: business-settings configuration layer, extended for economic-
 * model cost completeness (0047). The one place that decides whether
 * `settings` represents a real, operator-saved business decision or a
 * placeholder — used by `assemble.ts` (every cost rate for the
 * profitability/pricing calls, and the top-level gate for
 * `recommendProduct`) so the two can never independently drift.
 */
export function resolveBusinessConfiguration(settings: AutomationSettings): BusinessConfigurationStatus {
  const packagingConfigured = settings.packagingCostMinor !== null

  const missingRequired: string[] = []
  if (!settings.businessSettingsConfigured) {
    missingRequired.push('No business settings have been saved for this organisation yet.')
  } else {
    if (settings.vatRegistered && settings.vatRatePct === null) missingRequired.push('VAT rate (the business is registered but no rate is set).')
    if (settings.returnRatePct === null) missingRequired.push('Expected return rate.')
    if (settings.returnLossPct === null) missingRequired.push('Return loss percentage (how much of a returned unit\'s cost is unrecoverable).')
    if (settings.refundRatePct === null) missingRequired.push('Expected refund rate.')
    if (settings.chargebackRatePct === null) missingRequired.push('Expected chargeback rate.')
    if (settings.chargebackFeeMinor === null) missingRequired.push('Chargeback fixed fee.')
    if (settings.importDutyPct === null) missingRequired.push('Import duty / customs assumption.')
  }

  return {
    configured: missingRequired.length === 0,
    missingRequired,
    effectiveVatRatePct: settings.vatRegistered && settings.vatRatePct !== null ? settings.vatRatePct : 0,
    effectivePackagingCostMinor: settings.packagingCostMinor ?? 0,
    effectiveReturnRatePct: settings.returnRatePct ?? 0,
    effectiveReturnLossPct: settings.returnLossPct ?? 0,
    effectiveRefundRatePct: settings.refundRatePct ?? 0,
    effectiveChargebackRatePct: settings.chargebackRatePct ?? 0,
    effectiveChargebackFeeMinor: settings.chargebackFeeMinor ?? 0,
    effectiveImportDutyPct: settings.importDutyPct ?? 0,
    packagingConfigured,
  }
}
