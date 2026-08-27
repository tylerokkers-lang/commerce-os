'use client'

import { useActionState } from 'react'
import { Badge, CardHeader, type Tone } from '@/components/ui'
import { DECISION_LABELS, DECISION_TONES, CHANNEL_LABELS } from '@/lib/constants'
import { formatDateTime } from '@/lib/utils'
import { changeChannelDecision } from './actions'
import { initialDecisionChangeState } from './state'
import { PRODUCT_DECISIONS } from '@/lib/products/decision'
import { deriveChannelRecommendation } from '@/lib/marketplaces/channelRecommendation'
import type { ChannelReadinessRow } from '@/lib/products/repository'
import type { ComplianceVerdict } from '@/lib/core/domain'
import type { CheckOutcome } from '@/lib/compliance/rules'

const COMPLIANCE_STATUS_LABELS: Record<ComplianceVerdict, string> = {
  pass: 'PASS',
  review_required: 'REVIEW REQUIRED',
  fail: 'BLOCKED',
  not_assessed: 'NOT ASSESSED',
}

const COMPLIANCE_STATUS_TONES: Record<ComplianceVerdict, Tone> = {
  pass: 'positive',
  review_required: 'caution',
  fail: 'negative',
  not_assessed: 'neutral',
}

const CHECK_SYMBOL: Record<CheckOutcome, string> = { pass: '✓', fail: '✕', unknown: '?', not_applicable: '–' }

/**
 * The channel-level counterpart to `DecisionControl.tsx` (HANDOVER.md §53's
 * recommended next milestone). One card per channel: the deterministic
 * SELL/WATCH/HOLD/REVIEW/REMOVE recommendation and the full "why" chain
 * behind it (`assessPublicationReadiness`'s own requirements — never a
 * second, invented reasoning engine), the operator's actual channel
 * decision, and the form to change it. The recommendation is read-only and
 * advisory; only the form below writes anything, exactly like the
 * product-level control.
 */

const RECOMMENDATION_TONES: Record<string, Tone> = {
  SELL: 'positive',
  WATCH: 'neutral',
  HOLD: 'caution',
  REVIEW: 'caution',
  REMOVE: 'negative',
}

export function ChannelDecisionControl({ productId, row, canEdit }: { productId: string; row: ChannelReadinessRow; canEdit: boolean }) {
  const [state, formAction, pending] = useActionState(changeChannelDecision, initialDecisionChangeState)
  const { recommendation, reason } = deriveChannelRecommendation(row.readiness)

  return (
    <>
      <CardHeader
        title={CHANNEL_LABELS[row.channel]}
        description="Commerce-OS's deterministic recommendation for this channel, and the operator decision that actually gates it."
        action={<Badge tone={RECOMMENDATION_TONES[recommendation]} className="text-sm">{recommendation}</Badge>}
      />

      <div className="border-t border-border px-5 py-3">
        <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Why</p>
        <p className="mt-1 text-sm text-ink-muted">{reason}</p>
        <ul className="mt-3 space-y-1.5">
          {row.readiness.requirements.map((requirement) => (
            <li key={requirement.key} className="flex items-start gap-2 text-xs">
              <span aria-hidden className={requirement.satisfied ? 'text-positive' : 'text-negative'}>
                {requirement.satisfied ? '✓' : '✕'}
              </span>
              <span>
                <span className="font-medium">{requirement.label}:</span>{' '}
                <span className="text-ink-muted">{requirement.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-border px-5 py-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Compliance status</p>
          <Badge tone={row.compliance ? COMPLIANCE_STATUS_TONES[row.compliance.verdict] : 'neutral'}>
            {row.compliance ? COMPLIANCE_STATUS_LABELS[row.compliance.verdict] : 'NOT ASSESSED'}
          </Badge>
        </div>
        {row.compliance ? (
          <>
            <p className="mt-1 text-sm text-ink-muted">{row.compliance.summary}</p>
            <ul className="mt-3 space-y-1.5">
              {row.compliance.checks.map((check) => (
                <li key={check.key} className="flex items-start gap-2 text-xs">
                  <span aria-hidden className={check.outcome === 'pass' ? 'text-positive' : check.outcome === 'fail' ? 'text-negative' : 'text-ink-subtle'}>
                    {CHECK_SYMBOL[check.outcome]}
                  </span>
                  <span>
                    <span className="font-medium">{check.label}:</span>{' '}
                    <span className="text-ink-muted">{check.evidence}</span>
                    {check.remedy ? <span className="text-ink-subtle"> — {check.remedy}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {row.complianceCaveats.length > 0 ? (
              <div className="mt-3 rounded-lg border border-border px-3 py-2">
                <p className="text-xs font-medium text-ink-subtle">Checks this system cannot yet perform</p>
                <ul className="mt-1 space-y-1">
                  {row.complianceCaveats.map((caveat) => (
                    <li key={caveat} className="flex items-start gap-2 text-xs text-ink-subtle">
                      <span aria-hidden>?</span>
                      <span>{caveat}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="mt-3 text-xs text-ink-subtle">{row.compliance.disclaimer}</p>
          </>
        ) : (
          <p className="mt-1 text-sm text-ink-muted">
            Compliance information incomplete — this product could not be assessed (no product record found to check against).
          </p>
        )}
      </div>

      <div className="border-t border-border px-5 py-3">
        <p className="text-sm text-ink-subtle">Operator decision for {CHANNEL_LABELS[row.channel]}</p>
        <div className="mt-1 flex items-center gap-2">
          <Badge tone={DECISION_TONES[row.decision]}>{DECISION_LABELS[row.decision]}</Badge>
        </div>
        <p className="mt-2 text-xs text-ink-subtle">
          Changed by {row.decisionChangedBy ?? 'unknown'} · {row.decisionChangedAt ? formatDateTime(row.decisionChangedAt) : 'never set'}
        </p>
        {row.decisionReason ? <p className="mt-1 text-xs text-ink-subtle">Reason: &quot;{row.decisionReason}&quot;</p> : null}
      </div>

      {canEdit ? (
        <form action={formAction} className="grid gap-3 border-t border-border px-5 py-4 sm:grid-cols-2">
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="channel" value={row.channel} />
          <input type="hidden" name="from" value={row.decision} />

          <div>
            <label htmlFor={`to-${row.channel}`} className="block text-sm font-medium text-ink">
              New decision for {CHANNEL_LABELS[row.channel]}
            </label>
            <select
              id={`to-${row.channel}`}
              name="to"
              defaultValue={row.decision}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
            >
              {PRODUCT_DECISIONS.map((decision) => (
                <option key={decision} value={decision}>{DECISION_LABELS[decision]}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={`reason-${row.channel}`} className="block text-sm font-medium text-ink">Reason / note</label>
            <textarea
              id={`reason-${row.channel}`}
              name="reason"
              rows={2}
              placeholder="e.g. Margin too thin on this channel's fees"
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
            />
          </div>

          <div className="flex items-center gap-3 sm:col-span-2">
            <button type="submit" disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {pending ? 'Saving…' : `Save ${CHANNEL_LABELS[row.channel]} decision`}
            </button>
            {state.message ? (
              <span className={state.status === 'error' ? 'text-sm text-negative' : 'text-sm text-positive'}>{state.message}</span>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="border-t border-border px-5 py-3 text-sm text-ink-subtle">Your role cannot change this channel&apos;s decision.</p>
      )}
    </>
  )
}
