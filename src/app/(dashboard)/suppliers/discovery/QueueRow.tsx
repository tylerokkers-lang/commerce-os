'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Badge, type Tone } from '@/components/ui'
import { importCandidateAction, rejectCandidateAction } from './actions'
import { initialQueueActionState } from './state'
import type { DiscoveryCandidate } from '@/lib/suppliers/discovery/repository'

const STATUS_TONES: Record<string, Tone> = {
  new: 'accent',
  duplicate: 'caution',
  promoted: 'positive',
  rejected: 'negative',
  scored: 'accent',
  archived: 'neutral',
}

const STATUS_LABELS: Record<string, string> = {
  new: 'Awaiting review',
  duplicate: 'Possible duplicate',
  promoted: 'Imported',
  rejected: 'Rejected',
  scored: 'Scored',
  archived: 'Archived',
}

function formatMoney(minor: number | null, currency: string): string {
  if (minor === null) return 'Not set'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(minor / 100)
}

export function QueueRow({ candidate }: { candidate: DiscoveryCandidate }) {
  const [importState, importAction, importPending] = useActionState(importCandidateAction, initialQueueActionState)
  const [rejectState, rejectAction, rejectPending] = useActionState(rejectCandidateAction, initialQueueActionState)
  const [acknowledge, setAcknowledge] = useState(false)
  const [showReject, setShowReject] = useState(false)

  const isDecided = candidate.status === 'promoted' || candidate.status === 'rejected'

  return (
    <tr className="border-b border-border align-top">
      <td className="px-3 py-3">
        <p className="text-sm font-medium text-ink">{candidate.candidateTitle}</p>
        {candidate.category ? <p className="text-xs text-ink-subtle">{candidate.category}</p> : null}
        {candidate.sourceReference ? (
          <a href={candidate.sourceReference} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
            Source link
          </a>
        ) : null}
      </td>
      <td className="px-3 py-3 text-sm text-ink">{candidate.supplierName ?? <span className="text-ink-subtle">None</span>}</td>
      <td className="px-3 py-3 text-sm text-ink tabular-nums">{formatMoney(candidate.unitCostMinor, candidate.currency)}</td>
      <td className="px-3 py-3 text-sm text-ink tabular-nums">{formatMoney(candidate.shippingCostMinor, candidate.currency)}</td>
      <td className="px-3 py-3">
        <Badge tone={STATUS_TONES[candidate.status] ?? 'neutral'}>{STATUS_LABELS[candidate.status] ?? candidate.status}</Badge>
        {candidate.statusReason ? <p className="mt-1 max-w-xs text-xs text-ink-subtle">{candidate.statusReason}</p> : null}
      </td>
      <td className="px-3 py-3">
        {candidate.status === 'promoted' && candidate.productId ? (
          <Link href={`/products/${candidate.productId}`} className="text-sm text-accent hover:underline">
            View product
          </Link>
        ) : isDecided ? null : (
          <div className="flex flex-col gap-2">
            <form action={importAction} className="flex flex-col gap-1.5">
              <input type="hidden" name="candidateId" value={candidate.id} />
              {candidate.status === 'duplicate' ? (
                <label className="flex items-center gap-1.5 text-xs text-ink-subtle">
                  <input type="checkbox" checked={acknowledge} onChange={(e) => setAcknowledge(e.target.checked)} />
                  Import anyway — genuinely different product
                </label>
              ) : null}
              <input type="hidden" name="acknowledgeDuplicate" value={acknowledge ? 'on' : ''} />
              <button
                type="submit"
                disabled={importPending || !candidate.supplierId || candidate.unitCostMinor === null || (candidate.status === 'duplicate' && !acknowledge)}
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                {importPending ? 'Importing…' : 'Import'}
              </button>
            </form>

            {!showReject ? (
              <button type="button" onClick={() => setShowReject(true)} className="text-left text-xs text-ink-subtle underline hover:text-negative">
                Reject
              </button>
            ) : (
              <form action={rejectAction} className="flex flex-col gap-1.5">
                <input type="hidden" name="candidateId" value={candidate.id} />
                <input name="reason" placeholder="Reason" required className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-ink" />
                <button type="submit" disabled={rejectPending} className="rounded-lg border border-negative px-3 py-1.5 text-xs font-medium text-negative disabled:opacity-40">
                  {rejectPending ? 'Rejecting…' : 'Confirm reject'}
                </button>
              </form>
            )}

            {(!candidate.supplierId || candidate.unitCostMinor === null) && (
              <p className="text-xs text-caution">{!candidate.supplierId ? 'No supplier assigned yet.' : 'No cost on file yet.'}</p>
            )}
          </div>
        )}
        {importState.message ? <p className={`mt-1 text-xs ${importState.status === 'error' ? 'text-negative' : 'text-positive'}`}>{importState.message}</p> : null}
        {rejectState.message ? <p className={`mt-1 text-xs ${rejectState.status === 'error' ? 'text-negative' : 'text-positive'}`}>{rejectState.message}</p> : null}
      </td>
    </tr>
  )
}
