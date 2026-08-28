'use client'

import { useActionState } from 'react'
import { captureCandidateAction } from './actions'
import { initialCaptureState } from './state'

export function CaptureCandidateForm({ suppliers }: { suppliers: readonly { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(captureCandidateAction, initialCaptureState)

  return (
    <form action={formAction} className="grid gap-4 px-5 py-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor="candidateTitle" className="block text-sm font-medium text-ink">Product title</label>
        <input id="candidateTitle" name="candidateTitle" required className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" />
      </div>

      <div>
        <label htmlFor="supplierId" className="block text-sm font-medium text-ink">Supplier</label>
        <select id="supplierId" name="supplierId" className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25">
          <option value="">Not yet decided</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink-subtle">A supplier must be set before this candidate can be imported.</p>
      </div>

      <div>
        <label htmlFor="category" className="block text-sm font-medium text-ink">Category</label>
        <input id="category" name="category" className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" />
      </div>

      <div>
        <label htmlFor="supplierSku" className="block text-sm font-medium text-ink">Supplier SKU</label>
        <input id="supplierSku" name="supplierSku" className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" />
      </div>

      <div>
        <label htmlFor="sourceReference" className="block text-sm font-medium text-ink">Product URL / reference</label>
        <input id="sourceReference" name="sourceReference" type="url" placeholder="https://…" className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" />
      </div>

      <div>
        <label htmlFor="unitCostMajor" className="block text-sm font-medium text-ink">Supplier cost</label>
        <input id="unitCostMajor" name="unitCostMajor" type="number" step="0.01" min="0" className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" />
      </div>

      <div>
        <label htmlFor="shippingCostMajor" className="block text-sm font-medium text-ink">Shipping cost</label>
        <input id="shippingCostMajor" name="shippingCostMajor" type="number" step="0.01" min="0" className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" />
      </div>

      <div>
        <label htmlFor="currency" className="block text-sm font-medium text-ink">Currency</label>
        <input id="currency" name="currency" defaultValue="GBP" maxLength={3} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" />
      </div>

      <div>
        <label htmlFor="deliveryDaysMin" className="block text-sm font-medium text-ink">Delivery days (min)</label>
        <input id="deliveryDaysMin" name="deliveryDaysMin" type="number" min="0" className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" />
      </div>

      <div>
        <label htmlFor="deliveryDaysMax" className="block text-sm font-medium text-ink">Delivery days (max)</label>
        <input id="deliveryDaysMax" name="deliveryDaysMax" type="number" min="0" className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" />
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="notes" className="block text-sm font-medium text-ink">Notes</label>
        <textarea id="notes" name="notes" rows={2} className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25" />
      </div>

      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? 'Capturing…' : 'Capture candidate'}
        </button>
        {state.message ? <span className={state.status === 'error' ? 'text-sm text-negative' : 'text-sm text-positive'}>{state.message}</span> : null}
      </div>
    </form>
  )
}
