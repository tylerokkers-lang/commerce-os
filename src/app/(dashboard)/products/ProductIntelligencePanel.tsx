'use client'

import { useActionState } from 'react'
import { Badge, CardHeader, type Tone } from '@/components/ui'
import { recalculateProductIntelligence } from './actions'
import { initialIntelligenceState } from './state'
import type { ProductIntelligenceRow } from '@/lib/products/intelligence/repository'
import { RECOMMENDATION_LABELS, type ProductRecommendation } from '@/lib/products/intelligence/recommendation'

const RECOMMENDATION_TONES: Record<ProductRecommendation, Tone> = {
  strong_candidate: 'positive',
  candidate: 'accent',
  review_required: 'caution',
  low_priority: 'neutral',
  do_not_sell: 'negative',
  unconfigured: 'neutral',
}

const QUALITY_BAND_TONES: Record<string, Tone> = { excellent: 'positive', good: 'accent', fair: 'caution', poor: 'negative' }
const RISK_BAND_TONES: Record<string, Tone> = { low: 'positive', medium: 'accent', high: 'caution', severe: 'negative' }

function formatMoneyMinor(minor: number | null, currency: string): string {
  if (minor === null) return 'Not available'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(minor / 100)
}

function ScoreCard({ title, score, bandLabel, tone, children }: { title: string; score: number; bandLabel: string; tone: Tone; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">{title}</p>
        <Badge tone={tone}>{bandLabel}</Badge>
      </div>
      <p className="mt-1 text-2xl font-semibold text-ink">{score}<span className="text-sm font-normal text-ink-subtle">/100</span></p>
      {children}
    </div>
  )
}

export function ProductIntelligencePanel({ productId, data, canEdit }: { productId: string; data: ProductIntelligenceRow | null; canEdit: boolean }) {
  const [state, formAction, pending] = useActionState(recalculateProductIntelligence, initialIntelligenceState)

  return (
    <>
      <CardHeader
        title="Product intelligence"
        description="Is this product actually worth selling? Deterministic quality, risk, opportunity and capital scores, and the recommendation derived from them — never the source of truth for the decision below, only its evidence."
        action={
          data ? <Badge tone={RECOMMENDATION_TONES[data.recommendation]} className="text-sm">{RECOMMENDATION_LABELS[data.recommendation]}</Badge> : undefined
        }
      />

      {!data ? (
        <div className="border-t border-border px-5 py-6 text-sm text-ink-muted">
          Not calculated yet.
          {canEdit ? (
            <form action={formAction} className="mt-3">
              <input type="hidden" name="productId" value={productId} />
              <button type="submit" disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {pending ? 'Calculating…' : 'Calculate now'}
              </button>
            </form>
          ) : null}
        </div>
      ) : (
        <>
          <div className="border-t border-border px-5 py-4">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Why</p>
            <p className="mt-1 text-sm text-ink-muted">{data.recommendationReason}</p>
          </div>

          <div className="grid gap-4 border-t border-border px-5 py-4 sm:grid-cols-3">
            <ScoreCard title="Quality" score={data.quality.total} bandLabel={data.quality.bandLabel} tone={QUALITY_BAND_TONES[data.quality.band] ?? 'neutral'}>
              <ul className="mt-2 space-y-1">
                {data.quality.components.map((c) => (
                  <li key={c.key} className="flex items-center justify-between text-xs text-ink-subtle">
                    <span>{c.label}</span>
                    <span className="tabular-nums">{c.points}/{c.maxPoints}</span>
                  </li>
                ))}
              </ul>
            </ScoreCard>

            <ScoreCard title="Risk" score={data.risk.total} bandLabel={data.risk.bandLabel} tone={RISK_BAND_TONES[data.risk.band] ?? 'neutral'}>
              <p className="mt-2 text-xs text-ink-subtle">Higher = more risk.</p>
              <ul className="mt-1 space-y-1">
                {data.risk.components.filter((c) => c.score !== null).map((c) => (
                  <li key={c.key} className="flex items-center justify-between text-xs text-ink-subtle">
                    <span>{c.label}</span>
                    <span className="tabular-nums">{c.score}</span>
                  </li>
                ))}
              </ul>
            </ScoreCard>

            <ScoreCard title="Opportunity" score={data.opportunity.total} bandLabel={data.opportunity.bandLabel} tone={data.opportunity.total >= 70 ? 'positive' : data.opportunity.total >= 50 ? 'caution' : 'negative'}>
              <ul className="mt-2 space-y-1">
                {data.opportunity.components.filter((c) => c.score !== null).slice(0, 5).map((c) => (
                  <li key={c.key} className="flex items-center justify-between text-xs text-ink-subtle">
                    <span>{c.label}</span>
                    <span className="tabular-nums">{c.score}</span>
                  </li>
                ))}
              </ul>
            </ScoreCard>
          </div>

          <div className="border-t border-border px-5 py-4">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Capital</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-ink-subtle">Capital required per order</p>
                <p className="text-sm font-medium text-ink">{formatMoneyMinor(data.capital.capitalRequirementMinor, data.currency)}</p>
              </div>
              <div>
                <p className="text-xs text-ink-subtle">Capital efficiency</p>
                <p className="text-sm font-medium text-ink">{data.capital.capitalEfficiencyScore === null ? 'Not available' : `${data.capital.capitalEfficiencyScore}/100`}</p>
              </div>
              <div>
                <p className="text-xs text-ink-subtle">Simultaneous orders fundable</p>
                <p className="text-sm font-medium text-ink">{data.capital.maxSimultaneousOrders ?? 'Not configured'}</p>
              </div>
            </div>
            <p className="mt-2 text-xs text-ink-subtle">{data.capital.basis}</p>
            {data.capital.warnings.map((w) => (
              <p key={w} className="mt-1 text-xs text-caution">{w}</p>
            ))}
          </div>

          <div className="border-t border-border px-5 py-4">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Pricing</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-ink-subtle">Recommended price</p>
                <p className="text-sm font-medium text-ink">{formatMoneyMinor(data.recommendedPriceMinor, data.currency)}</p>
              </div>
              <div>
                <p className="text-xs text-ink-subtle">Minimum viable price</p>
                <p className="text-sm font-medium text-ink">{formatMoneyMinor(data.minimumViablePriceMinor, data.currency)}</p>
              </div>
            </div>
          </div>

          <div className="border-t border-border px-5 py-4">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Profitability breakdown</p>
            <ul className="mt-2 space-y-1">
              {data.profitabilityBreakdown.map((line) => (
                <li key={line.label} className="flex items-center justify-between text-xs">
                  <span className="text-ink-subtle">{line.label} <span className="text-ink-subtle/70">— {line.basis}</span></span>
                  <span className="tabular-nums text-ink">{formatMoneyMinor(line.amount.minor, data.currency)}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="border-t border-border px-5 py-3 text-xs text-ink-subtle">
            Calculated {new Date(data.computedAt).toLocaleString('en-GB')}.
          </div>

          {canEdit ? (
            <form action={formAction} className="flex items-center gap-3 border-t border-border px-5 py-4">
              <input type="hidden" name="productId" value={productId} />
              <button type="submit" disabled={pending} className="rounded-lg border border-border-strong px-4 py-2 text-sm font-medium text-ink disabled:opacity-50">
                {pending ? 'Recalculating…' : 'Recalculate'}
              </button>
              {state.message ? <span className={state.status === 'error' ? 'text-sm text-negative' : 'text-sm text-positive'}>{state.message}</span> : null}
            </form>
          ) : null}
        </>
      )}
    </>
  )
}
