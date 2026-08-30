'use client'

import { useActionState } from 'react'
import { discoverFromCjAction, captureFromCjAction } from './actions'
import { initialCjDiscoveryState, initialCaptureState } from './state'

function formatMoneyMinor(minor: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(minor / 100)
}

function CjResultRow({ item, suppliers }: { item: { productRef: string; title: string; sku: string | null; unitCostMinor: number; currency: string; inStock: boolean }; suppliers: readonly { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(captureFromCjAction, initialCaptureState)
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <div>
        <p className="text-sm font-medium text-ink">{item.title}</p>
        <p className="text-xs text-ink-subtle">
          {item.sku ?? item.productRef} · {formatMoneyMinor(item.unitCostMinor, item.currency)} · {item.inStock ? 'In stock' : 'Out of stock'}
        </p>
      </div>
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="productRef" value={item.productRef} />
        <select name="supplierId" className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-ink">
          <option value="">Not yet decided</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button type="submit" disabled={pending} className="rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50">
          {pending ? 'Capturing…' : 'Capture as candidate'}
        </button>
      </form>
      {state.message ? <p className={`w-full text-xs ${state.status === 'error' ? 'text-negative' : 'text-positive'}`}>{state.message}</p> : null}
    </li>
  )
}

export function CjDiscoveryPanel({ configured, suppliers }: { configured: boolean; suppliers: readonly { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(discoverFromCjAction, initialCjDiscoveryState)

  if (!configured) {
    return (
      <p className="px-5 py-4 text-sm text-ink-subtle">
        Not configured — set <code className="rounded bg-surface-inset px-1">CJ_API_KEY</code> to enable discovery directly from CJdropshipping&apos;s real product catalogue.
      </p>
    )
  }

  return (
    <div className="px-5 py-4">
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input name="keyword" placeholder="Search keyword (optional)" className="min-w-[220px] flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink" />
        <button type="submit" disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? 'Searching…' : 'Search CJdropshipping'}
        </button>
      </form>
      {state.message ? <p className={`mt-2 text-xs ${state.status === 'error' ? 'text-negative' : 'text-ink-subtle'}`}>{state.message}</p> : null}
      {state.items.length > 0 ? (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {state.items.map((item) => (
            <CjResultRow key={item.productRef} item={item} suppliers={suppliers} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}
