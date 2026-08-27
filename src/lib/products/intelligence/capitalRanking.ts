/**
 * Capital-aware ranking (Milestone: product intelligence, Phase 4).
 *
 * The whole point: a product should not rank above another purely because
 * it earns more profit per unit if it also ties up far more cash to
 * fulfil. `capitalRequirementMinor` reuses `calculateProfitability`'s own
 * `cashRequiredPerUnit` (`../../profitability`) — cash out the door before
 * a marketplace payout arrives — rather than a new cost calculation. For
 * dropshipping that is genuinely the right capital figure: nothing here
 * assumes bulk inventory is ever purchased.
 *
 * `availableOperatingCapitalMinor`/`cashBufferMinor` come from
 * `business_settings` (0037) and are `null` until the owner sets them —
 * every function below treats `null` as "not yet configured" and reports
 * that honestly, rather than silently treating an unset capital figure as
 * zero (which would make every product look unaffordable) or unlimited
 * (which would defeat the entire point of this feature).
 */

export interface CapitalSignals {
  /** Cash required to fulfil one unit of this product — `Profitability.cashRequiredPerUnit.minor`. Null when cost data is too incomplete to trust the figure. */
  capitalRequirementMinor: number | null
  /** `Profitability.contribution.minor` — used only to rank capital efficiency, not restated as profit. */
  contributionMinor: number | null
  availableOperatingCapitalMinor: number | null
  cashBufferMinor: number | null
}

export interface CapitalAssessment {
  capitalRequirementMinor: number | null
  /** Available capital minus the safety buffer — what's actually free to spend. Null when capital isn't configured. */
  spendableCapitalMinor: number | null
  /** How many units of this specific product could be fulfilled simultaneously with today's spendable capital. Null when either figure is unknown. */
  maxSimultaneousOrders: number | null
  /** 0-100. Return generated per pound of capital tied up, relative to other products — never in isolation. Null when contribution or capital requirement is unknown. */
  capitalEfficiencyScore: number | null
  status: 'not_configured' | 'data_incomplete' | 'insufficient_capital' | 'within_buffer' | 'sufficient'
  basis: string
  warnings: readonly string[]
}

function efficiencyScore(contributionMinor: number, capitalRequirementMinor: number): number {
  if (capitalRequirementMinor <= 0) return 0
  const ratio = contributionMinor / capitalRequirementMinor
  // A ratio of 0.2 (20p contribution per £1 tied up) is weak; 1.5+ is
  // excellent for a single-order dropshipping cycle. Floor/ceiling chosen
  // to spread realistic dropshipping ratios across the full scale rather
  // than compressing them all into the top or bottom decile.
  return Math.max(0, Math.min(100, ((ratio - 0.1) / (1.5 - 0.1)) * 100))
}

export function assessCapitalRequirement(signals: CapitalSignals): CapitalAssessment {
  const { capitalRequirementMinor, contributionMinor, availableOperatingCapitalMinor, cashBufferMinor } = signals
  const warnings: string[] = []

  const capitalEfficiencyScore =
    capitalRequirementMinor !== null && capitalRequirementMinor > 0 && contributionMinor !== null
      ? Math.round(efficiencyScore(contributionMinor, capitalRequirementMinor))
      : null

  if (capitalRequirementMinor === null) {
    return {
      capitalRequirementMinor: null,
      spendableCapitalMinor: null,
      maxSimultaneousOrders: null,
      capitalEfficiencyScore,
      status: 'data_incomplete',
      basis: 'Supplier cost and/or shipping is not on file, so the cash required to fulfil an order cannot be calculated.',
      warnings,
    }
  }

  if (availableOperatingCapitalMinor === null) {
    return {
      capitalRequirementMinor,
      spendableCapitalMinor: null,
      maxSimultaneousOrders: null,
      capitalEfficiencyScore,
      status: 'not_configured',
      basis: 'Available operating capital has not been set in Settings, so this cannot be checked against what you can actually afford.',
      warnings,
    }
  }

  const buffer = cashBufferMinor ?? 0
  const spendableCapitalMinor = Math.max(0, availableOperatingCapitalMinor - buffer)
  const maxSimultaneousOrders = capitalRequirementMinor > 0 ? Math.floor(spendableCapitalMinor / capitalRequirementMinor) : null

  if (cashBufferMinor === null) {
    warnings.push('No cash buffer is configured — the full operating capital figure is being treated as spendable.')
  }

  if (spendableCapitalMinor < capitalRequirementMinor) {
    return {
      capitalRequirementMinor,
      spendableCapitalMinor,
      maxSimultaneousOrders: 0,
      capitalEfficiencyScore,
      status: 'insufficient_capital',
      basis: `A single order needs more cash than is currently available after the buffer (${(capitalRequirementMinor / 100).toFixed(2)} required vs ${(spendableCapitalMinor / 100).toFixed(2)} spendable).`,
      warnings,
    }
  }

  if (maxSimultaneousOrders !== null && maxSimultaneousOrders <= 2) {
    warnings.push(`Only ${maxSimultaneousOrders} simultaneous order${maxSimultaneousOrders === 1 ? '' : 's'} of this product could currently be funded — a small demand spike could outrun available capital.`)
  }

  return {
    capitalRequirementMinor,
    spendableCapitalMinor,
    maxSimultaneousOrders,
    capitalEfficiencyScore,
    status: buffer > 0 ? 'within_buffer' : 'sufficient',
    basis: `${(capitalRequirementMinor / 100).toFixed(2)} required per order; ${maxSimultaneousOrders ?? '—'} simultaneous orders could currently be funded.`,
    warnings,
  }
}
