import { Badge, Card, CardHeader, PageHeader, StatTile } from '@/components/ui'
import { formatMoney, marginPct } from '@/lib/core/money'
import { formatDate } from '@/lib/utils'
import { getCashflow } from '@/lib/analytics/repository'
import { getFinanceSummary } from '@/lib/tax/repository'

export const dynamic = 'force-dynamic'

export default async function FinancePage() {
  const [finance, cashflow] = await Promise.all([getFinanceSummary(), getCashflow()])
  const thresholdUsedPct = marginPct(finance.rollingTurnover, finance.vatThreshold)

  return (
    <>
      <PageHeader
        title="Finance and VAT"
        description="The operational view of the numbers. Your accounting software remains the formal record; this layer keeps it fed and shows what needs attention."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Invoices generated" value={String(finance.invoicesGenerated)} sublabel={`${finance.invoicesSent} sent`} />
        <StatTile
          label="Invoices failed to send"
          value={String(finance.invoicesFailed)}
          sublabel="Retried automatically"
          tone={finance.invoicesFailed > 0 ? 'caution' : 'neutral'}
        />
        <StatTile label="Credit notes issued" value={String(finance.creditNotesIssued)} sublabel="Originals retained" />
        <StatTile
          label="Transactions needing review"
          value={String(finance.vatTransactionsNeedingReview)}
          sublabel="Flagged for a human"
          tone={finance.vatTransactionsNeedingReview > 0 ? 'caution' : 'neutral'}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="VAT position"
            description="Estimated from recorded transactions. It is not a filing, and it is not tax advice."
          />
          <dl className="divide-y divide-border text-sm">
            <div className="flex items-center justify-between px-5 py-3">
              <dt className="text-ink-muted">VAT registered</dt>
              <dd><Badge tone={finance.vatRegistered ? 'positive' : 'neutral'}>{finance.vatRegistered ? 'Yes' : 'No'}</Badge></dd>
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <dt className="text-ink-muted">Output VAT (on sales)</dt>
              <dd className="tabular">{formatMoney(finance.outputVat)}</dd>
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <dt className="text-ink-muted">Input VAT (on purchases)</dt>
              <dd className="tabular">{formatMoney(finance.inputVat)}</dd>
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <dt className="font-medium">Estimated VAT due</dt>
              <dd className="tabular font-medium">{formatMoney(finance.estimatedVatDue)}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Registration threshold" description="Rolling turnover against the configured UK threshold." />
          <div className="px-5 py-4">
            <div className="flex items-baseline justify-between">
              <span className="tabular text-2xl font-semibold">{formatMoney(finance.rollingTurnover)}</span>
              <span className="text-sm text-ink-muted">of {formatMoney(finance.vatThreshold)}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-muted">
              <div
                className={
                  thresholdUsedPct !== null && thresholdUsedPct > 85
                    ? 'h-full bg-caution'
                    : 'h-full bg-accent'
                }
                style={{ width: `${Math.min(100, thresholdUsedPct ?? 0)}%` }}
              />
            </div>
            <p className="mt-3 text-sm text-ink-muted">
              {finance.vatThresholdStatus === 'registered'
                ? 'Already VAT registered, so the threshold is tracked for reference only.'
                : thresholdUsedPct !== null && thresholdUsedPct > 85
                  ? 'Approaching the registration threshold. Speak to your accountant before it is reached.'
                  : 'Comfortably below the registration threshold.'}
            </p>
            <p className="mt-2 text-xs text-ink-subtle">
              The threshold is a configurable value, not a fixed number in the code, so it can be
              updated when it changes.
            </p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Cashflow"
          description="Profit and cash are different things. This is the order the money actually moves in."
        />
        <div className="grid gap-px bg-border sm:grid-cols-2">
          <div className="bg-surface px-5 py-4">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Expected in</p>
            <ul className="mt-2 space-y-2">
              {cashflow.expectedPayouts.length === 0 ? (
                <li className="text-sm text-ink-muted">No payouts scheduled.</li>
              ) : (
                cashflow.expectedPayouts.map((payout) => (
                  <li key={payout.label} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-ink-muted">{payout.label}</span>
                    <span className="tabular shrink-0 text-positive">
                      {formatMoney(payout.amount)}
                      <span className="ml-2 text-xs text-ink-subtle">{formatDate(payout.expectedOn)}</span>
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>
          <div className="bg-surface px-5 py-4">
            <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">Committed out</p>
            <ul className="mt-2 space-y-2">
              {cashflow.upcomingCommitments.length === 0 ? (
                <li className="text-sm text-ink-muted">No commitments due.</li>
              ) : (
                cashflow.upcomingCommitments.map((item) => (
                  <li key={item.label} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-ink-muted">{item.label}</span>
                    <span className="tabular shrink-0 text-negative">
                      {formatMoney(item.amount)}
                      <span className="ml-2 text-xs text-ink-subtle">{formatDate(item.dueOn)}</span>
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
        {cashflow.warning ? (
          <div className="border-t border-caution/30 bg-caution-soft px-5 py-3">
            <p className="text-sm text-ink">{cashflow.warning}</p>
          </div>
        ) : null}
      </Card>

      <Card className="border-caution/30">
        <div className="px-5 py-4">
          <p className="text-sm font-medium">Your responsibilities</p>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            This system records, calculates and organises. It does not file returns and it is not a
            substitute for professional advice. VAT registration, tax filings, legal compliance and
            every financial approval remain yours. Transactions the system is not confident about are
            flagged for review rather than quietly assumed.
          </p>
        </div>
      </Card>
    </>
  )
}
