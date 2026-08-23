'use client'

import { useActionState } from 'react'
import { Card, CardHeader } from '@/components/ui'
import { saveSupplier } from './actions'
import { initialSupplierState } from './state'

export interface SupplierFormValues {
  id?: string
  name?: string
  company_name?: string | null
  website?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  country?: string | null
  platform?: string | null
  notes?: string | null
  typical_delivery_days_min?: number | null
  typical_delivery_days_max?: number | null
  supports_blind_shipping?: boolean
  supports_custom_packaging?: boolean
  supports_custom_invoice?: boolean
  supports_own_branding?: boolean
  provides_tracking?: boolean
  handles_returns?: boolean
  accepts_faulty_returns?: boolean
  returns_policy?: string | null
  returns_window_days?: number | null
  min_order_value_minor?: number | null
  orders_placed?: number | null
  orders_late?: number | null
  orders_defective?: number | null
  quality_rating?: number | null
  communication_rating?: number | null
}

function Field({
  label, name, defaultValue, hint, error, type = 'text', step, min, max,
}: {
  label: string
  name: string
  defaultValue?: string | number | null
  hint?: string
  error?: string
  type?: string
  step?: string
  min?: string
  max?: string
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-ink">{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        step={step}
        min={min}
        max={max}
        defaultValue={defaultValue ?? ''}
        aria-invalid={error ? true : undefined}
        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
      />
      {hint ? <p className="mt-1 text-xs text-ink-subtle">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs text-negative">{error}</p> : null}
    </div>
  )
}

function Check({
  label, name, defaultChecked, hint,
}: {
  label: string
  name: string
  defaultChecked?: boolean
  hint: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={name}
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked ?? false}
        className="mt-0.5 size-4 shrink-0 rounded border-border text-accent"
      />
      <div>
        <label htmlFor={name} className="text-sm text-ink">{label}</label>
        <p className="text-xs text-ink-subtle">{hint}</p>
      </div>
    </div>
  )
}

export function SupplierForm({
  supplier,
  canEdit,
}: {
  supplier: SupplierFormValues
  canEdit: boolean
}) {
  const [state, formAction, pending] = useActionState(saveSupplier, initialSupplierState)
  const errors = state.fieldErrors

  return (
    <form action={formAction} className="grid gap-6">
      {supplier.id ? <input type="hidden" name="id" value={supplier.id} /> : null}

      <Card>
        <CardHeader title="Identity" description="Who they are and how to reach them." />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <Field label="Supplier name" name="name" defaultValue={supplier.name} error={errors.name} />
          <Field label="Registered company name" name="company_name" defaultValue={supplier.company_name} />
          <Field label="Website" name="website" type="url" defaultValue={supplier.website} error={errors.website} />
          <Field label="Contact email" name="contact_email" type="email" defaultValue={supplier.contact_email} error={errors.contact_email} />
          <Field label="Contact phone" name="contact_phone" defaultValue={supplier.contact_phone} />
          <Field label="Country" name="country" defaultValue={supplier.country} hint="Two-letter code, such as GB or CN" error={errors.country} />
          <Field label="Platform" name="platform" defaultValue={supplier.platform} hint="direct, wholesaler, aliexpress, and so on" />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Capability"
          description="These decide channel eligibility. An unticked box means the supplier has not committed to it, which is how it will be read."
        />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <Check
            label="Can issue invoices and packing slips in our name"
            name="supports_custom_invoice"
            defaultChecked={supplier.supports_custom_invoice}
            hint="Required for Amazon. Without it we cannot remain the seller of record."
          />
          <Check
            label="Ships blind"
            name="supports_blind_shipping"
            defaultChecked={supplier.supports_blind_shipping}
            hint="Required for Amazon. No other retailer's branding on the parcel or paperwork."
          />
          <Check
            label="Handles returns"
            name="handles_returns"
            defaultChecked={supplier.handles_returns}
            hint="Required for Amazon. Responsibility for returns cannot be passed to the customer."
          />
          <Check
            label="Provides tracking"
            name="provides_tracking"
            defaultChecked={supplier.provides_tracking}
            hint="Required for Amazon, and it prevents most delivery enquiries on Shopify."
          />
          <Check
            label="Accepts faulty goods back"
            name="accepts_faulty_returns"
            defaultChecked={supplier.accepts_faulty_returns}
            hint="Decides who absorbs the cost of a defect."
          />
          <Check
            label="Custom packaging"
            name="supports_custom_packaging"
            defaultChecked={supplier.supports_custom_packaging}
            hint="Needed for any packaging-based differentiation."
          />
          <Check
            label="Our own branding"
            name="supports_own_branding"
            defaultChecked={supplier.supports_own_branding}
            hint="Required before a product can move to private label."
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Terms" description="Delivery, returns and minimums as quoted by the supplier." />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <Field label="Delivery days, minimum" name="typical_delivery_days_min" type="number" min="0" max="120" defaultValue={supplier.typical_delivery_days_min ?? 2} error={errors.typical_delivery_days_min} />
          <Field label="Delivery days, maximum" name="typical_delivery_days_max" type="number" min="0" max="120" defaultValue={supplier.typical_delivery_days_max ?? 5} error={errors.typical_delivery_days_max} />
          <Field label="Returns window (days)" name="returns_window_days" type="number" min="0" max="365" defaultValue={supplier.returns_window_days ?? 30} error={errors.returns_window_days} />
          <Field label="Minimum order value (£)" name="min_order_value_major" type="number" step="0.01" min="0" defaultValue={supplier.min_order_value_minor ? supplier.min_order_value_minor / 100 : 0} />
          <div className="sm:col-span-2">
            <label htmlFor="returns_policy" className="block text-sm font-medium text-ink">Returns policy</label>
            <textarea
              id="returns_policy"
              name="returns_policy"
              rows={2}
              defaultValue={supplier.returns_policy ?? ''}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Observed performance"
          description="What has actually happened, as opposed to what was promised. A supplier with no history is scored as unproven rather than as reliable."
        />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
          <Field label="Orders placed" name="orders_placed" type="number" min="0" defaultValue={supplier.orders_placed ?? 0} error={errors.orders_placed} />
          <Field label="Orders late" name="orders_late" type="number" min="0" defaultValue={supplier.orders_late ?? 0} error={errors.orders_late} />
          <Field label="Orders defective" name="orders_defective" type="number" min="0" defaultValue={supplier.orders_defective ?? 0} error={errors.orders_defective} />
          <Field label="Quality rating (1 to 5)" name="quality_rating" type="number" step="0.1" min="1" max="5" defaultValue={supplier.quality_rating} error={errors.quality_rating} />
          <Field label="Communication rating (1 to 5)" name="communication_rating" type="number" step="0.1" min="1" max="5" defaultValue={supplier.communication_rating} error={errors.communication_rating} />
        </div>
        <div className="border-t border-border px-5 py-4">
          <label htmlFor="notes" className="block text-sm font-medium text-ink">Notes</label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            defaultValue={supplier.notes ?? ''}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
          />
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !canEdit}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Saving…' : supplier.id ? 'Save supplier' : 'Create supplier'}
        </button>
        {!canEdit ? <span className="text-sm text-ink-subtle">Your role cannot change suppliers.</span> : null}
        {state.message ? (
          <span className={state.status === 'saved' ? 'text-sm text-positive' : 'text-sm text-negative'}>
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  )
}
