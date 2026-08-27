'use client'

import { useActionState } from 'react'
import { Badge, CardHeader } from '@/components/ui'
import { DECISION_LABELS, DECISION_TONES } from '@/lib/constants'
import { formatDateTime } from '@/lib/utils'
import { changeProductDecision } from './actions'
import { initialDecisionChangeState } from './state'
import { PRODUCT_DECISIONS } from '@/lib/products/decision'
import type { ProductDetail } from '@/lib/products/repository'

/**
 * The "Commerce-OS Decision" control — deliberately its own block, visually
 * separate from the product's marketplace/approval/compliance/supplier
 * status shown elsewhere on the page. Those are read from their own
 * sources and never feed back into or overwrite this value; this control
 * is the only thing that ever writes `products.decision`.
 */
export function DecisionControl({ product, canEdit }: { product: ProductDetail; canEdit: boolean }) {
  const [state, formAction, pending] = useActionState(changeProductDecision, initialDecisionChangeState)

  return (
    <>
      <CardHeader title="Commerce-OS decision" description="What you have decided this product is allowed to do. This is an operational control, not a label — it gates listing and pricing everywhere, but never bypasses profitability, compliance, supplier or approval requirements." />
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <p className="text-sm text-ink-subtle">Current decision</p>
          <div className="mt-1 flex items-center gap-2">
            <Badge tone={DECISION_TONES[product.decision]} className="text-sm">
              {DECISION_LABELS[product.decision]}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-ink-subtle">
            Changed by {product.decisionChangedBy ?? 'unknown'} · {formatDateTime(product.decisionChangedAt)}
          </p>
          {product.decisionReason ? <p className="mt-1 text-xs text-ink-subtle">Reason: “{product.decisionReason}”</p> : null}
        </div>

        {canEdit ? (
          <form action={formAction} className="grid gap-3 sm:col-span-2">
            <input type="hidden" name="productId" value={product.id} />
            <input type="hidden" name="from" value={product.decision} />

            <div>
              <label htmlFor="to" className="block text-sm font-medium text-ink">
                New decision
              </label>
              <select
                id="to"
                name="to"
                defaultValue={product.decision}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
              >
                {PRODUCT_DECISIONS.map((decision) => (
                  <option key={decision} value={decision}>
                    {DECISION_LABELS[decision]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="reason" className="block text-sm font-medium text-ink">
                Reason / note
              </label>
              <textarea
                id="reason"
                name="reason"
                rows={2}
                placeholder="e.g. Testing demand before scaling"
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {pending ? 'Saving…' : 'Save decision'}
              </button>
              {state.message ? (
                <span className={state.status === 'error' ? 'text-sm text-negative' : 'text-sm text-positive'}>{state.message}</span>
              ) : null}
            </div>
          </form>
        ) : (
          <p className="text-sm text-ink-subtle sm:col-span-2">Your role cannot change this product&apos;s decision.</p>
        )}
      </div>
    </>
  )
}
