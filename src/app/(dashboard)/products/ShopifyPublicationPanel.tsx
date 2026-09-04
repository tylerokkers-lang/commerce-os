'use client'

import { useActionState, useState } from 'react'
import { Badge, CardHeader, type Tone } from '@/components/ui'
import {
  createShopifyDraftAction,
  publishShopifyListingAction,
  pauseShopifyListingAction,
  overrideShopifyPriceAction,
} from './publicationActions'
import { initialPublicationState } from './state'
import type { ShopifyPublicationPreview } from '@/lib/marketplaces/shopify/publicationService'

function formatMoneyMinor(minor: number | null, currency: string): string {
  if (minor === null) return 'Not set'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(minor / 100)
}

const WORKFLOW_LABELS: Record<string, string> = {
  discovered: 'Discovered',
  evaluating: 'Evaluating',
  approved: 'Approved',
  ready_to_list: 'Ready to list',
  pending_approval: 'Draft — pending approval',
  published: 'Live on Shopify',
  paused: 'Paused',
  ended: 'Archived',
  blocked: 'Blocked',
}

const WORKFLOW_TONES: Record<string, Tone> = {
  discovered: 'neutral',
  evaluating: 'neutral',
  approved: 'accent',
  ready_to_list: 'accent',
  pending_approval: 'caution',
  published: 'positive',
  paused: 'caution',
  ended: 'neutral',
  blocked: 'negative',
}

export function ShopifyPublicationPanel({ productId, preview, canEdit }: { productId: string; preview: ShopifyPublicationPreview; canEdit: boolean }) {
  const [draftState, draftAction, draftPending] = useActionState(createShopifyDraftAction, initialPublicationState)
  const [publishState, publishAction, publishPending] = useActionState(publishShopifyListingAction, initialPublicationState)
  const [pauseState, pauseAction, pausePending] = useActionState(pauseShopifyListingAction, initialPublicationState)
  const [overrideState, overrideAction, overridePending] = useActionState(overrideShopifyPriceAction, initialPublicationState)

  const [showOverride, setShowOverride] = useState(false)
  const [confirmPublish, setConfirmPublish] = useState(false)

  const workflowState = preview.currentListing?.workflowState ?? null
  const hasDraft = Boolean(preview.currentListing?.externalId)

  return (
    <>
      <CardHeader
        title="Shopify publication"
        description="Draft first, always. Live publication is a separate, explicit action that re-checks everything below before it runs."
        action={workflowState ? <Badge tone={WORKFLOW_TONES[workflowState] ?? 'neutral'}>{WORKFLOW_LABELS[workflowState] ?? workflowState}</Badge> : undefined}
      />

      <div className="border-t border-border px-5 py-4">
        <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Publication eligibility</p>
        <ul className="mt-2 space-y-1.5">
          {preview.eligibility.requirements.map((r) => (
            <li key={r.key} className="flex items-start gap-2 text-xs">
              <span aria-hidden className={r.satisfied ? 'text-positive' : 'text-negative'}>{r.satisfied ? '✓' : '✕'}</span>
              <span>
                <span className="font-medium">{r.label}:</span> <span className="text-ink-muted">{r.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        {preview.eligibility.warnings.map((w) => (
          <p key={w} className="mt-2 text-xs text-caution">⚠ {w}</p>
        ))}
        <p className={`mt-3 text-sm font-medium ${preview.eligibility.eligible ? 'text-positive' : 'text-negative'}`}>
          {preview.eligibility.eligible ? 'ELIGIBLE' : 'BLOCKED'}
        </p>
      </div>

      <div className="grid gap-4 border-t border-border px-5 py-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-ink-subtle">Recommended price</p>
          <p className="text-sm font-medium text-ink">{formatMoneyMinor(preview.pricing.recommendedPriceMinor, preview.pricing.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-ink-subtle">Minimum viable price</p>
          <p className="text-sm font-medium text-ink">{formatMoneyMinor(preview.pricing.minimumViablePriceMinor, preview.pricing.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-ink-subtle">Selected selling price</p>
          <p className="text-sm font-medium text-ink">{formatMoneyMinor(preview.pricing.selectedPriceMinor, preview.pricing.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-ink-subtle">Supplier</p>
          <p className="text-sm font-medium text-ink">{preview.supplier?.supplierName ?? 'None selected'}</p>
        </div>
      </div>

      {canEdit ? (
        <div className="border-t border-border px-5 py-4">
          {!showOverride ? (
            <button type="button" onClick={() => setShowOverride(true)} className="text-xs text-accent underline">
              Override selling price
            </button>
          ) : (
            <form action={overrideAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="productId" value={productId} />
              <div>
                <label className="block text-xs text-ink-subtle" htmlFor="newPriceMajor">New price</label>
                <input id="newPriceMajor" name="newPriceMajor" type="number" step="0.01" min="0" required className="mt-1 w-28 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-ink" />
              </div>
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs text-ink-subtle" htmlFor="overrideReason">Reason</label>
                <input id="overrideReason" name="reason" required className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1 text-sm text-ink" />
              </div>
              <button type="submit" disabled={overridePending} className="rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50">
                {overridePending ? 'Checking…' : 'Override with reason'}
              </button>
            </form>
          )}
          {overrideState.message ? <p className={`mt-2 text-xs ${overrideState.status === 'error' ? 'text-negative' : 'text-positive'}`}>{overrideState.message}</p> : null}
        </div>
      ) : null}

      <div className="border-t border-border px-5 py-4">
        {!hasDraft ? (
          canEdit ? (
            <form action={draftAction} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="productId" value={productId} />
              <input type="hidden" name="selectedPriceMajor" value={preview.pricing.selectedPriceMinor ? preview.pricing.selectedPriceMinor / 100 : ''} />
              <button
                type="submit"
                disabled={draftPending || !preview.eligibility.eligible}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {draftPending ? 'Creating…' : 'Create Shopify draft'}
              </button>
              {draftState.message ? <span className={`text-sm ${draftState.status === 'error' ? 'text-negative' : 'text-positive'}`}>{draftState.message}</span> : null}
            </form>
          ) : null
        ) : (
          <div className="space-y-3">
            {preview.currentListing?.listingUrl ? (
              <a href={preview.currentListing.listingUrl} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
                View listing in Shopify admin
              </a>
            ) : null}

            {canEdit && workflowState === 'pending_approval' ? (
              <div>
                <label className="flex items-center gap-2 text-xs text-ink-subtle">
                  <input type="checkbox" checked={confirmPublish} onChange={(e) => setConfirmPublish(e.target.checked)} />
                  I have reviewed this listing and confirm it should go live on Shopify.
                </label>
                <form action={publishAction} className="mt-2 flex items-center gap-3">
                  <input type="hidden" name="productId" value={productId} />
                  <input type="hidden" name="confirmed" value={confirmPublish ? 'on' : ''} />
                  <button type="submit" disabled={publishPending || !confirmPublish} className="rounded-lg bg-positive px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                    {publishPending ? 'Publishing…' : 'Publish live'}
                  </button>
                  {publishState.message ? <span className={`text-sm ${publishState.status === 'error' ? 'text-negative' : 'text-positive'}`}>{publishState.message}</span> : null}
                </form>
              </div>
            ) : null}

            {canEdit && workflowState === 'published' ? (
              <form action={pauseAction} className="flex flex-wrap items-center gap-3">
                <input type="hidden" name="productId" value={productId} />
                <input name="reason" placeholder="Reason for pausing" required className="rounded-lg border border-border bg-surface px-2 py-1 text-sm text-ink" />
                <button type="submit" disabled={pausePending} className="rounded-lg border border-negative px-4 py-2 text-sm font-medium text-negative disabled:opacity-40">
                  {pausePending ? 'Pausing…' : 'Pause listing'}
                </button>
                {pauseState.message ? <span className={`text-sm ${pauseState.status === 'error' ? 'text-negative' : 'text-positive'}`}>{pauseState.message}</span> : null}
              </form>
            ) : null}
          </div>
        )}
      </div>
    </>
  )
}
