import type { AnalyticsDashboard } from './repository'

/**
 * Milestone 24 (testability follow-up) — `buildExecutiveSummary` was
 * pure logic living inside `repository.ts`, which has `import 'server-only'`
 * at module scope: any import from that file, even of an unrelated named
 * export, pulls that statement in and fails outside a server context
 * (confirmed empirically — Vitest cannot even load `repository.ts` at
 * all, since the `server-only` package is not installed as a real
 * dependency in this project and Node's module resolution fails
 * immediately). Relocated here, the same "pure planner, separate
 * server-only orchestrator" split this codebase already uses throughout
 * (`syncPlan.ts`/`sync.ts`, `monitorPlan.ts`/`monitor.ts`,
 * `verificationCheck.ts`/`verification.ts`, `amazonAdsReporting.ts`/
 * `amazonAdsReportPipeline.ts`) — behaviour is unchanged from Milestone
 * 24's own version, only the file it lives in.
 *
 * `AnalyticsDashboard` is imported with `import type` only — erased
 * entirely at compile time, so this file never actually loads
 * `repository.ts`'s runtime module (and its `server-only` import) even
 * though the type itself is declared there.
 */
export function buildExecutiveSummary(analytics: AnalyticsDashboard) {
  const knownMarginChannels = analytics.channels.filter((c) => c.profit.averageNetMarginPct.status === 'calculated' && typeof c.profit.averageNetMarginPct.value === 'number')
  const knownNetMarginPct = knownMarginChannels.length === 0
    ? null
    : Math.round((knownMarginChannels.reduce((sum, c) => sum + (c.profit.averageNetMarginPct.value as number), 0) / knownMarginChannels.length) * 100) / 100
  const profitDataComplete = analytics.channels.length > 0 && analytics.channels.every((c) => c.profit.productsWithUnknownProfit === 0) && knownNetMarginPct !== null

  return {
    isDemo: analytics.isDemo,
    periodLabel: analytics.period.label,
    revenue: analytics.sales.revenue,
    netRevenue: analytics.sales.netRevenue,
    orders: analytics.sales.orders,
    averageOrderValue: analytics.sales.averageOrderValue,
    refundsValue: analytics.sales.refundsValue,
    refundRatePct: analytics.sales.refundRatePct,
    returnRatePct: analytics.sales.returnRatePct,
    knownNetMarginPct,
    profitDataComplete,
  }
}
