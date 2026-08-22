'use client'

import { useActionState } from 'react'
import { Card, CardHeader } from '@/components/ui'
import { saveBusinessSettings } from './actions'
import { initialSettingsState } from './state'
import type { Tables } from '@/lib/supabase/database.types'

type Settings = Partial<Tables<'business_settings'>>

function Field({
  label,
  name,
  defaultValue,
  hint,
  error,
  type = 'text',
  step,
  min,
  max,
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
      <label htmlFor={name} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        step={step}
        min={min}
        max={max}
        defaultValue={defaultValue ?? ''}
        aria-describedby={hint ? `${name}-hint` : undefined}
        aria-invalid={error ? true : undefined}
        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
      />
      {hint ? (
        <p id={`${name}-hint`} className="mt-1 text-xs text-ink-subtle">
          {hint}
        </p>
      ) : null}
      {error ? <p className="mt-1 text-xs text-negative">{error}</p> : null}
    </div>
  )
}

export function SettingsForm({ settings, canEdit }: { settings: Settings; canEdit: boolean }) {
  const [state, formAction, pending] = useActionState(saveBusinessSettings, initialSettingsState)
  const errors = state.fieldErrors

  return (
    <form action={formAction} className="grid gap-6">
      <Card>
        <CardHeader
          title="Legal identity"
          description="These details appear on every invoice you issue, so they must match your registered business."
        />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <Field label="Legal name" name="legal_name" defaultValue={settings.legal_name} error={errors.legal_name} />
          <Field label="Trading name" name="trading_name" defaultValue={settings.trading_name} hint="If different from the legal name" />
          <Field label="Address" name="address_line1" defaultValue={settings.address_line1} />
          <Field label="City" name="city" defaultValue={settings.city} />
          <Field label="Postcode" name="postcode" defaultValue={settings.postcode} />
          <Field label="Email" name="email" type="email" defaultValue={settings.email} error={errors.email} />
          <Field label="Company number" name="company_number" defaultValue={settings.company_number} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="VAT"
          description="A document is only ever labelled a VAT invoice when the business is genuinely VAT registered. The database enforces this as well."
        />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <div className="flex items-start gap-2.5 sm:col-span-2">
            <input
              id="vat_registered"
              name="vat_registered"
              type="checkbox"
              defaultChecked={settings.vat_registered ?? false}
              className="mt-0.5 size-4 rounded border-border text-accent"
            />
            <label htmlFor="vat_registered" className="text-sm text-ink">
              This business is VAT registered
            </label>
          </div>
          <Field label="VAT number" name="vat_number" defaultValue={settings.vat_number} error={errors.vat_number} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Automation and limits"
          description="What the system may do on its own, and where it must stop and ask. Anything above these limits becomes an approval request rather than an action."
        />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="automation_level" className="block text-sm font-medium text-ink">
              Automation level
            </label>
            <select
              id="automation_level"
              name="automation_level"
              defaultValue={settings.automation_level ?? 'assisted'}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
            >
              <option value="manual">Manual — recommend only, never act</option>
              <option value="assisted">Assisted — act on low-risk items, ask for the rest</option>
              <option value="supervised">Supervised — act within limits, ask above them</option>
              <option value="autonomous">Autonomous — act within limits without asking</option>
            </select>
            <p className="mt-1 text-xs text-ink-subtle">
              No level allows compliance blocks, spending limits or approval requirements to be
              bypassed.
            </p>
          </div>

          <Field label="Minimum gross margin (%)" name="min_gross_margin_pct" type="number" step="0.1" min="0" max="95" defaultValue={settings.min_gross_margin_pct} error={errors.min_gross_margin_pct} />
          <Field label="Minimum net margin (%)" name="min_net_margin_pct" type="number" step="0.1" min="0" max="95" defaultValue={settings.min_net_margin_pct} error={errors.min_net_margin_pct} hint="Products below this fail the profitability gate" />
          <Field label="Minimum opportunity score" name="min_opportunity_score" type="number" min="0" max="100" defaultValue={settings.min_opportunity_score} error={errors.min_opportunity_score} />
          <Field label="Maximum automatic purchase (£)" name="max_auto_purchase_major" type="number" step="0.01" min="0" defaultValue={settings.max_auto_purchase_minor ? settings.max_auto_purchase_minor / 100 : 200} hint="Above this, a purchase needs your approval" error={errors.max_auto_purchase_minor} />
          <Field label="Maximum automatic price change (%)" name="max_auto_price_change_pct" type="number" step="0.1" min="0" max="50" defaultValue={settings.max_auto_price_change_pct} error={errors.max_auto_price_change_pct} />
          <Field label="Maximum daily advertising spend (£)" name="max_daily_ad_spend_major" type="number" step="0.01" min="0" defaultValue={settings.max_daily_ad_spend_minor ? settings.max_daily_ad_spend_minor / 100 : 50} error={errors.max_daily_ad_spend_minor} />
          <Field label="Minimum ROAS" name="min_roas" type="number" step="0.1" min="0" max="50" defaultValue={settings.min_roas} hint="Advertising below this is reduced or paused" error={errors.min_roas} />
          <Field label="Maximum delivery time (days)" name="max_delivery_days" type="number" min="1" max="60" defaultValue={settings.max_delivery_days} error={errors.max_delivery_days} />
          <Field label="Maximum return rate (%)" name="max_return_rate_pct" type="number" step="0.1" min="0" max="100" defaultValue={settings.max_return_rate_pct} hint="Above this, a product is paused and reviewed" error={errors.max_return_rate_pct} />
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || !canEdit}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save settings'}
        </button>
        {!canEdit ? (
          <span className="text-sm text-ink-subtle">Your role cannot change business settings.</span>
        ) : null}
        {state.message ? (
          <span className={state.status === 'saved' ? 'text-sm text-positive' : 'text-sm text-negative'}>
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  )
}
