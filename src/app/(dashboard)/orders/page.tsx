import { Badge, Card, CardHeader, EmptyState, PageHeader, type Tone } from '@/components/ui'
import { formatMoney, money } from '@/lib/core/money'
import { formatPct } from '@/lib/utils'
import { getOrderScenarios, getPurchaseQueue } from '@/lib/orders/repository'
import { getSession, canWrite } from '@/lib/security/session'
import { PurchaseQueue } from './PurchaseQueue'

export const dynamic = 'force-dynamic'

const SUBMISSION_TONES: Record<string, Tone> = {
  submit_automatically: 'positive',
  pending_approval: 'caution',
  blocked: 'negative',
}

const SUBMISSION_LABELS: Record<string, string> = {
  submit_automatically: 'Submitting automatically',
  pending_approval: 'Awaiting your approval',
  blocked: 'Blocked',
}

export default async function OrdersPage() {
  const [session, scenarios, purchaseQueue] = await Promise.all([getSession(), getOrderScenarios(), getPurchaseQueue()])
  const canEdit = session !== null && canWrite(session)

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every order runs through the same pipeline: ingestion, validation, supplier selection, a profitability re-check against its real price and cost, a compliance re-check where the fulfilling supplier has changed, and a submission decision gated by your automation level."
      />

      <Card className="border-accent/30 bg-accent-soft">
        <div className="px-5 py-4">
          <p className="text-sm font-medium text-accent">Nothing here places an order</p>
          <p className="mt-1 max-w-3xl text-sm text-ink">
            This page shows what the orchestration engine would decide for each order. A fulfilment
            is only ever submitted to a supplier once every requirement below has passed and the
            automation level permits it — otherwise it waits in Approvals for you.
          </p>
        </div>
      </Card>

      <div>
        <h2 className="text-base font-semibold text-ink">Purchase queue</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-subtle">
          Fulfilments waiting on you: a supplier purchase, a shipment reference, or a delivery
          confirmation. Commerce-OS never buys anything or contacts a supplier itself — every action
          below only records something you already did.
        </p>

        {session?.isDemo ? (
          <Card className="mt-3">
            <EmptyState
              title="Not modelled in demo mode"
              description="Demo mode has no real Supabase-backed orders, so there is nothing genuine to show here — this queue only ever reflects real fulfilments waiting on a real person. Connect Supabase and ingest a real order to see it populate."
            />
          </Card>
        ) : purchaseQueue.length === 0 ? (
          <Card className="mt-3">
            <EmptyState
              title="Nothing waiting on you"
              description="No fulfilment currently needs a purchase, shipment reference, or delivery confirmation."
            />
          </Card>
        ) : (
          <div className="mt-3">
            <PurchaseQueue items={purchaseQueue} canEdit={canEdit} />
          </div>
        )}
      </div>

      {scenarios.length === 0 ? (
        <Card>
          <EmptyState
            title="No orders yet"
            description="Orders appear here once a marketplace connector has ingested one. No live connector is connected yet."
          />
        </Card>
      ) : (
        <div className="grid gap-4">
          {scenarios.map((scenario) => (
            <Card key={scenario.snapshot.externalId}>
              <CardHeader
                title={scenario.label}
                description={scenario.description}
                action={
                  <div className="text-right">
                    <p className="tabular text-sm font-medium">{formatMoney(money(scenario.snapshot.totalMinor, 'GBP'))}</p>
                    <p className="text-xs text-ink-subtle">
                      {scenario.channel === 'amazon_uk' ? 'Amazon UK' : 'Shopify'} · {scenario.snapshot.externalId}
                    </p>
                  </div>
                }
              />

              <dl className="grid gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
                <div className="bg-surface px-5 py-3">
                  <dt className="text-xs text-ink-subtle">Ingestion</dt>
                  <dd className="mt-0.5">
                    <Badge tone={scenario.result.ingestion.outcome === 'rejected' ? 'negative' : 'positive'}>
                      {scenario.result.ingestion.outcome.replace(/_/g, ' ')}
                    </Badge>
                  </dd>
                </div>
                <div className="bg-surface px-5 py-3">
                  <dt className="text-xs text-ink-subtle">Supplier</dt>
                  <dd className="mt-0.5 text-sm font-medium">
                    {scenario.result.supplierChoice.chosen?.name ?? 'None available'}
                    {!scenario.result.supplierChoice.matchesApprovedSupplier && scenario.result.supplierChoice.chosen ? (
                      <Badge tone="caution" className="ml-1.5">Not the approved supplier</Badge>
                    ) : null}
                  </dd>
                </div>
                <div className="bg-surface px-5 py-3">
                  <dt className="text-xs text-ink-subtle">Profitability re-check</dt>
                  <dd className="mt-0.5">
                    <Badge tone={scenario.result.profitability.passesMinimumMargin ? 'positive' : 'negative'}>
                      {scenario.result.profitability.passesMinimumMargin
                        ? `Passes (${formatPct(scenario.result.profitability.perUnit.netMarginPct)})`
                        : 'Fails'}
                    </Badge>
                  </dd>
                </div>
                <div className="bg-surface px-5 py-3">
                  <dt className="text-xs text-ink-subtle">Compliance re-check</dt>
                  <dd className="mt-0.5">
                    <Badge
                      tone={
                        !scenario.result.complianceRecheck.required
                          ? 'neutral'
                          : scenario.result.submission.requirements.find((r) => r.key === 'compliance')?.satisfied
                            ? 'positive'
                            : 'negative'
                      }
                    >
                      {scenario.result.complianceRecheck.required ? 'Required' : 'Not needed'}
                    </Badge>
                  </dd>
                </div>
              </dl>

              <div className="border-t border-border px-5 py-4">
                <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">
                  Fulfilment submission
                </p>
                <div className="mt-2 flex items-start justify-between gap-3">
                  <p className="max-w-2xl text-sm text-ink-muted">{scenario.result.submission.reason}</p>
                  <Badge tone={SUBMISSION_TONES[scenario.result.submission.outcome]}>
                    {SUBMISSION_LABELS[scenario.result.submission.outcome]}
                  </Badge>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {scenario.result.submission.requirements.map((requirement) => (
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
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
