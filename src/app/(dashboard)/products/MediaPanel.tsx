'use client'

import { useActionState, useState } from 'react'
import { Badge, CardHeader, type Tone } from '@/components/ui'
import {
  attachMediaAction,
  approveMediaAction,
  rejectMediaAction,
  setPrimaryMediaAction,
  removeMediaAction,
  refreshMediaAction,
  initialMediaState,
} from './mediaActions'
import type { ProductMediaRow } from '@/lib/products/media/repository'
import type { MediaReadinessResult } from '@/lib/products/media/mediaScore'

const READINESS_LABELS: Record<MediaReadinessResult['status'], string> = {
  media_ready: 'Media ready',
  media_review_required: 'Review required',
  media_not_ready: 'Not ready',
}

const READINESS_TONES: Record<MediaReadinessResult['status'], Tone> = {
  media_ready: 'positive',
  media_review_required: 'caution',
  media_not_ready: 'negative',
}

const VALIDATION_ICON: Record<ProductMediaRow['validation_status'], string> = {
  approved: '🟢',
  review_required: '🟡',
  rejected: '🔴',
}

const VALIDATION_LABEL: Record<ProductMediaRow['validation_status'], string> = {
  approved: 'Approved',
  review_required: 'Review required',
  rejected: 'Rejected',
}

const PROVENANCE_LABEL: Record<ProductMediaRow['provenance_status'], string> = {
  verified_supplier: 'Level 1 — supplier-provided',
  verified_manufacturer: 'Level 2 — manufacturer-provided',
  user_provided_unverified_rights: 'Level 3 — user-provided (rights not verified)',
  unverified_source: 'Level 4 — unverified source',
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'Unknown'
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`
}

function MediaActionForm({
  action,
  productId,
  mediaId,
  children,
  extraFields,
}: {
  action: (state: { status: 'idle' | 'ok' | 'error'; message: string }, formData: FormData) => Promise<{ status: 'idle' | 'ok' | 'error'; message: string }>
  productId: string
  mediaId: string
  children: React.ReactNode
  extraFields?: React.ReactNode
}) {
  const [state, formAction, pending] = useActionState(action, initialMediaState)
  return (
    <form action={formAction} className="inline-flex flex-col items-start gap-1">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="mediaId" value={mediaId} />
      {extraFields}
      <button type="submit" disabled={pending} className="text-left">
        {children}
      </button>
      {state.message ? <span className={`text-[11px] ${state.status === 'error' ? 'text-negative' : 'text-positive'}`}>{state.message}</span> : null}
    </form>
  )
}

function MediaCard({ media, productId, canEdit, canRemove }: { media: ProductMediaRow; productId: string; canEdit: boolean; canRemove: boolean }) {
  const [rejecting, setRejecting] = useState(false)
  const [rejectState, rejectAction, rejectPending] = useActionState(rejectMediaAction, initialMediaState)

  return (
    <div className="flex gap-4 rounded-xl border border-border p-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external hosts; next/image would require allow-listing every supplier domain in advance */}
      <img src={media.media_url} alt="" className="h-24 w-24 flex-none rounded-lg border border-border object-cover" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">
            {VALIDATION_ICON[media.validation_status]} {VALIDATION_LABEL[media.validation_status]}
          </span>
          <Badge tone="neutral">{media.role}</Badge>
          {media.is_demo ? <Badge tone="demo">Demo</Badge> : null}
        </div>
        <p className="mt-1 truncate text-xs text-ink-subtle">{media.media_url}</p>
        <p className="mt-1 text-xs text-ink-muted">{PROVENANCE_LABEL[media.provenance_status]}</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-subtle">
          <span>{media.width && media.height ? `${media.width}×${media.height}px` : 'Dimensions unknown'}</span>
          <span>{media.format?.toUpperCase() ?? 'Format unknown'}</span>
          <span>{formatBytes(media.file_size_bytes)}</span>
        </div>
        <p className="mt-1 text-xs text-ink-muted">{media.validation_reason}</p>
        {media.watermark_status === 'detected' ? <p className="mt-1 text-xs text-negative">⚠ {media.watermark_detail}</p> : null}
        {media.product_match_status !== 'matched' ? <p className="mt-1 text-xs text-caution">Product match: {media.product_match_status} — {media.product_match_detail}</p> : null}

        {canEdit ? (
          <div className="mt-2 flex flex-wrap items-start gap-3 text-xs font-medium text-accent">
            {media.validation_status !== 'approved' ? (
              <MediaActionForm action={approveMediaAction} productId={productId} mediaId={media.id}>Approve</MediaActionForm>
            ) : null}
            {media.role !== 'primary' && media.validation_status === 'approved' ? (
              <MediaActionForm action={setPrimaryMediaAction} productId={productId} mediaId={media.id}>Set as primary</MediaActionForm>
            ) : null}
            <MediaActionForm action={refreshMediaAction} productId={productId} mediaId={media.id}>Refresh</MediaActionForm>
            {media.validation_status !== 'rejected' ? (
              !rejecting ? (
                <button type="button" onClick={() => setRejecting(true)} className="text-negative">Reject</button>
              ) : (
                <form action={rejectAction} className="inline-flex flex-col items-start gap-1">
                  <input type="hidden" name="productId" value={productId} />
                  <input type="hidden" name="mediaId" value={media.id} />
                  <input name="reason" required placeholder="Reason" className="w-40 rounded-lg border border-border bg-surface px-2 py-1 text-xs text-ink" />
                  <button type="submit" disabled={rejectPending} className="text-negative">{rejectPending ? 'Rejecting…' : 'Confirm reject'}</button>
                  {rejectState.message ? <span className={`text-[11px] ${rejectState.status === 'error' ? 'text-negative' : 'text-positive'}`}>{rejectState.message}</span> : null}
                </form>
              )
            ) : null}
            {media.source_url ? (
              <a href={media.source_url} target="_blank" rel="noreferrer" className="text-ink-subtle underline">Review source</a>
            ) : null}
            {canRemove ? (
              <MediaActionForm action={removeMediaAction} productId={productId} mediaId={media.id}>
                <span className="text-negative">Remove</span>
              </MediaActionForm>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function MediaPanel({
  productId,
  media,
  readiness,
  canEdit,
  canRemove,
}: {
  productId: string
  media: readonly ProductMediaRow[]
  readiness: MediaReadinessResult
  canEdit: boolean
  canRemove: boolean
}) {
  const [attachState, attachAction, attachPending] = useActionState(attachMediaAction, initialMediaState)

  return (
    <>
      <CardHeader
        title="Product media"
        description="Every image is provenance-checked, quality-checked and product-matched before it can be used — finding an image never publishes a product on its own."
        action={<Badge tone={READINESS_TONES[readiness.status]}>{READINESS_LABELS[readiness.status]}</Badge>}
      />
      <div className="border-t border-border px-5 py-3">
        <p className="text-xs text-ink-subtle">{readiness.reason}</p>
      </div>

      <div className="space-y-3 border-t border-border px-5 py-4">
        {media.length === 0 ? (
          <p className="text-sm text-ink-subtle">No media has been attached to this product yet.</p>
        ) : (
          media.map((m) => <MediaCard key={m.id} media={m} productId={productId} canEdit={canEdit} canRemove={canRemove} />)
        )}
      </div>

      {canEdit ? (
        <div className="border-t border-border px-5 py-4">
          <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Attach an image</p>
          <form action={attachAction} className="mt-2 flex flex-wrap items-end gap-3">
            <input type="hidden" name="productId" value={productId} />
            <div className="min-w-[240px] flex-1">
              <label htmlFor="mediaUrl" className="block text-xs text-ink-subtle">Image URL</label>
              <input id="mediaUrl" name="mediaUrl" type="url" required placeholder="https://…" className="mt-1 w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-ink" />
            </div>
            <button type="submit" disabled={attachPending} className="rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50">
              {attachPending ? 'Checking…' : 'Attach'}
            </button>
          </form>
          {attachState.message ? <p className={`mt-2 text-xs ${attachState.status === 'error' ? 'text-negative' : 'text-positive'}`}>{attachState.message}</p> : null}
          <p className="mt-2 text-xs text-ink-subtle">Attached as user-provided — you are responsible for confirming you may use this image.</p>
        </div>
      ) : null}
    </>
  )
}
