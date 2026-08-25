import Link from 'next/link'
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatTile, type Tone } from '@/components/ui'
import { MetricStat } from '@/components/dashboard/MetricStat'
import { formatMoney } from '@/lib/core/money'
import { formatRelative } from '@/lib/utils'
import { isKnown } from '@/lib/analytics/types'
import { getCEOCommandCentre } from '@/lib/ceo/repository'
import { getAdvertisingConnectorSummaries } from '@/lib/advertising/repository'
import type { CampaignIntelligence } from '@/lib/analytics/repository'
import type { AdvertisingHealthStatus, CampaignClassification, CampaignSeverity } from '@/lib/analytics/advertisingAnalytics'
import type { AdvertisingConnectorSummary, AdvertisingConnectionStatus } from '@/lib/advertising/connectors/types'
import type { Priority } from '@/lib/ceo/types'

export const dynamic = 'force-dynamic'

/**
 * Milestone 14 — Advertising Intelligence. A presentation layer only, the
 * same discipline as `/` (the CEO Command Centre): everything here is
 * already computed by `analytics/advertisingAnalytics.ts`'s deterministic
 * rules and composed once into `ceo.advertisingIntelligence` /
 * `ceo.priorities` by `getCEOCommandCentre()` — nothing is recalculated on
 * this page, and it is the same single query the dashboard and chat
 * already make (never a second advertising fetch).
 *
 * There is deliberately no "Pause" / "Increase budget" button anywhere on
 * this page. Milestone 15 built a real `AdvertisingProvider` connector
 * architecture and a controlled, approval-gated execution pipeline
 * (`advertising/connectors/`, `automation/advertisingExecution.ts`), but no
 * platform is actually connected in this environment (no real API
 * credentials exist), and — deliberately, this milestone — nothing in that
 * pipeline can ever auto-execute a spend-changing action even once one is
 * connected (see `automation/advertisingAutomation.ts`'s module comment).
 * A button here that looked like it worked would still be a fake one. The
 * only real path from a recommendation to a trackable approval today is
 * Commerce Intelligence chat (`REVIEW_CAMPAIGN`, a pure escalation) — this
 * page points there and to `/approvals`, rather than pretending to be that
 * path itself.
 */

const HEALTH_TONE: Record<AdvertisingHealthStatus, Tone> = {
  healthy: 'positive', scale_opportunity: 'accent', insufficient_data: 'neutral', review: 'caution', at_risk: 'caution', critical: 'negative',
}
const HEALTH_LABEL: Record<AdvertisingHealthStatus, string> = {
  healthy: 'Healthy', scale_opportunity: 'Scale opportunity', insufficient_data: 'Insufficient data', review: 'Review', at_risk: 'At risk', critical: 'Critical',
}
const CLASSIFICATION_LABEL: Record<CampaignClassification, string> = {
  wasted_spend: 'Wasted spend', poor_profitability: 'Poor profitability', high_acos_low_roas: 'High ACOS / low ROAS',
  scale_opportunity: 'Scale opportunity', declining_performance: 'Declining performance', healthy: 'Healthy', insufficient_data: 'Insufficient data',
}
const SEVERITY_TONE: Record<CampaignSeverity, Tone> = { critical: 'negative', high: 'caution', medium: 'caution', opportunity: 'accent', info: 'neutral' }
const SEVERITY_RANK: Record<CampaignSeverity, number> = { critical: 0, high: 1, medium: 2, opportunity: 3, info: 4 }
const PRIORITY_TONE: Record<Priority['severity'], Tone> = { critical: 'negative', high: 'caution', medium: 'accent', low: 'neutral' }
const CHANNEL_LABEL: Record<string, string> = { shopify: 'Shopify', amazon_uk: 'Amazon UK' }
const CONNECTION_TONE: Record<AdvertisingConnectionStatus, Tone> = { connected: 'positive', demo: 'demo', not_configured: 'neutral', degraded: 'caution', error: 'negative' }
const CONNECTION_LABEL: Record<AdvertisingConnectionStatus, string> = { connected: 'Connected', demo: 'Demo', not_configured: 'Not connected', degraded: 'Degraded', error: 'Error' }

/**
 * Phase 13 — honest implementation status, a genuinely different axis
 * from `status`/`CONNECTION_LABEL` above: a platform can be "Not
 * connected" simply because nobody has entered credentials yet even
 * though the integration is real and working (never true for any
 * platform in this environment, but the distinction still matters), or
 * "Not connected" because the integration itself is a stub regardless of
 * credentials. Keyed by the registry key so it can never silently drift
 * from which connector class is actually registered.
 */
const IMPLEMENTATION_TONE: Record<string, Tone> = { amazon_ads: 'caution', meta_ads: 'neutral', google_ads: 'neutral', tiktok_ads: 'neutral' }
const IMPLEMENTATION_LABEL: Record<string, string> = {
  amazon_ads: 'Implemented — requires live verification',
  meta_ads: 'Stub — not implemented',
  google_ads: 'Stub — not implemented',
  tiktok_ads: 'Stub — not implemented',
}

function ConnectorRow({ connector }: { connector: AdvertisingConnectorSummary }) {
  return (
    <li className="px-5 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{connector.label}</p>
          {!connector.isConfigured && connector.missingCredentials.length > 0 ? (
            <p className="mt-0.5 text-xs text-ink-subtle">Missing: {connector.missingCredentials.join(', ')}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={CONNECTION_TONE[connector.status]}>{CONNECTION_LABEL[connector.status]}</Badge>
          <Badge tone={IMPLEMENTATION_TONE[connector.key] ?? 'neutral'}>{IMPLEMENTATION_LABEL[connector.key] ?? 'Unknown'}</Badge>
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-subtle">
        <span>Read: {connector.capabilities.readCampaigns ? 'yes' : 'no'}</span>
        <span>Pause: {connector.capabilities.pauseCampaign ? 'yes' : 'no'}</span>
        <span>Budget: {connector.capabilities.setBudget ? 'yes' : 'no'}</span>
        {connector.lastSyncAt ? <span>Last sync {formatRelative(connector.lastSyncAt)}</span> : null}
        {connector.lastError ? <span className="text-negative">{connector.lastError}</span> : null}
      </div>
    </li>
  )
}

function CampaignRow({ campaign }: { campaign: CampaignIntelligence }) {
  const { fact, classification } = campaign
  const { identity } = fact
  const needsAttention = classification.classification !== 'healthy' && classification.classification !== 'insufficient_data'

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{identity.campaignName}</p>
          <p className="mt-0.5 text-xs text-ink-subtle">
            {CHANNEL_LABEL[identity.channel] ?? identity.channel}
            {identity.isPaused ? ' · paused' : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Badge tone={SEVERITY_TONE[classification.severity]}>{CLASSIFICATION_LABEL[classification.classification].toUpperCase()}</Badge>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="text-xs text-ink-subtle">Spend</p>
          <p className="tabular text-sm font-medium">{isKnown(fact.spend) ? formatMoney(fact.spend.value) : <Badge tone="neutral">{fact.spend.status.toUpperCase()}</Badge>}</p>
        </div>
        <div>
          <p className="text-xs text-ink-subtle">Attributed revenue</p>
          <p className="tabular text-sm font-medium">{isKnown(fact.attributedRevenue) ? formatMoney(fact.attributedRevenue.value) : <Badge tone="neutral">{fact.attributedRevenue.status.toUpperCase()}</Badge>}</p>
        </div>
        <div>
          <p className="text-xs text-ink-subtle">ROAS</p>
          <p className="tabular text-sm font-medium">{isKnown(fact.roas) ? fact.roas.value.toFixed(2) : <Badge tone="neutral">{fact.roas.status.toUpperCase()}</Badge>}</p>
        </div>
        <div>
          <p className="text-xs text-ink-subtle">ACOS</p>
          <p className="tabular text-sm font-medium">{isKnown(fact.acosPct) ? `${fact.acosPct.value.toFixed(1)}%` : <Badge tone="neutral">{fact.acosPct.status.toUpperCase()}</Badge>}</p>
        </div>
        <div>
          <p className="text-xs text-ink-subtle">CPC</p>
          <p className="tabular text-sm font-medium">{isKnown(fact.cpc) ? formatMoney(fact.cpc.value) : <Badge tone="neutral">{fact.cpc.status.toUpperCase()}</Badge>}</p>
        </div>
        <div>
          <p className="text-xs text-ink-subtle">CPA</p>
          <p className="tabular text-sm font-medium">{isKnown(fact.cpa) ? formatMoney(fact.cpa.value) : <Badge tone="neutral">{fact.cpa.status.toUpperCase()}</Badge>}</p>
        </div>
        <div>
          <p className="text-xs text-ink-subtle">Avg. order value</p>
          <p className="tabular text-sm font-medium">{isKnown(fact.averageOrderValue) ? formatMoney(fact.averageOrderValue.value) : <Badge tone="neutral">{fact.averageOrderValue.status.toUpperCase()}</Badge>}</p>
        </div>
      </div>

      {classification.reasons.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {classification.reasons.map((reason) => (
            <li key={reason} className="text-xs text-ink-muted">{reason}</li>
          ))}
        </ul>
      ) : null}

      {needsAttention ? (
        <p className="mt-3 text-xs text-accent">
          Ask <Link href="/chat" className="underline hover:opacity-80">Commerce Intelligence chat</Link> to &quot;review campaign {identity.campaignName}&quot; to raise this for your review.
        </p>
      ) : null}
    </li>
  )
}

function PriorityRow({ priority }: { priority: Priority }) {
  return (
    <li className="px-5 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{priority.title}</p>
        </div>
        <Badge tone={PRIORITY_TONE[priority.severity]} className="shrink-0">{priority.severity.toUpperCase()}</Badge>
      </div>
      {priority.detail && priority.detail !== priority.title ? <p className="mt-1.5 text-sm text-ink-muted">{priority.detail}</p> : null}
      <p className="mt-1.5 text-xs text-ink-subtle">{priority.recommendedNextStep}</p>
    </li>
  )
}

export default async function AdvertisingPage() {
  const [ceo, connectors] = await Promise.all([getCEOCommandCentre(), getAdvertisingConnectorSummaries()])
  const { advertisingIntelligence } = ceo
  const { scorecard } = advertisingIntelligence
  const anyConnected = connectors.some((c) => c.status === 'connected')

  const campaigns = [...advertisingIntelligence.campaigns].sort(
    (a, b) => SEVERITY_RANK[a.classification.severity] - SEVERITY_RANK[b.classification.severity],
  )
  const advertisingPriorities = ceo.priorities.filter((p) => p.id.startsWith('advertising:'))
  const advertisingDataFailed = ceo.dataSourceFailures.includes('advertising')

  return (
    <>
      <PageHeader
        title="Advertising Intelligence"
        description="Deterministic classifications from real advertising spend and revenue — never an AI-generated score. A campaign can be paused, reviewed, or have its budget changed only through the existing approval process; nothing here executes automatically."
      />

      {advertisingDataFailed ? (
        <Card className="border-caution/40 bg-caution-soft">
          <div className="px-5 py-4">
            <p className="text-sm font-semibold text-caution">Advertising data could not be loaded this time</p>
            <p className="mt-1 text-sm text-ink">The figures below fall back to a safe empty state rather than showing possibly-wrong data. Reload the page to try again.</p>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Advertising platform connections"
          description="Amazon Ads, Meta Ads, Google Ads and TikTok Ads can each be connected here — no platform is connected in this environment, since no real API credentials exist. Connecting one does not, by itself, allow any automatic spend change; see the note below."
        />
        <ul className="divide-y divide-border border-t border-border">
          {connectors.map((c) => <ConnectorRow key={c.key} connector={c} />)}
        </ul>
      </Card>

      <Card>
        <CardHeader
          title="Advertising health"
          description={`${scorecard.totalCampaigns} campaign${scorecard.totalCampaigns === 1 ? '' : 's'} in the last 30 days.`}
          action={<Badge tone={HEALTH_TONE[scorecard.overall]}>{HEALTH_LABEL[scorecard.overall]}</Badge>}
        />
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
          <MetricStat label="Total spend" metric={scorecard.totalSpend} format={formatMoney as never} />
          <MetricStat label="Attributed revenue" metric={scorecard.totalAttributedRevenue} format={formatMoney as never} />
          <MetricStat label="Overall ROAS" metric={scorecard.overallRoas} format={((v: number) => v.toFixed(2)) as never} />
          <MetricStat label="Overall ACOS" metric={scorecard.overallAcosPct} format={((v: number) => `${v.toFixed(1)}%`) as never} />
          <MetricStat label="TACOS (of org sales)" metric={scorecard.tacosPct} format={((v: number) => `${v.toFixed(1)}%`) as never} />
          <MetricStat label="Impressions" metric={scorecard.totalImpressions} format={((v: number) => v.toLocaleString('en-GB')) as never} />
          <MetricStat label="Clicks" metric={scorecard.totalClicks} format={((v: number) => v.toLocaleString('en-GB')) as never} />
          <MetricStat label="Conversions" metric={scorecard.totalConversions} format={((v: number) => v.toLocaleString('en-GB')) as never} />
          <MetricStat label="Overall CPA" metric={scorecard.overallCpa} format={formatMoney as never} />
          <MetricStat label="Overall avg. order value" metric={scorecard.overallAverageOrderValue} format={formatMoney as never} />
        </div>
        {scorecard.totalCampaigns > 0 ? (
          <div className="flex flex-wrap gap-1.5 border-t border-border px-5 py-3">
            {(Object.keys(scorecard.byClassification) as CampaignClassification[])
              .filter((key) => scorecard.byClassification[key] > 0)
              .map((key) => (
                <StatTile key={key} label={CLASSIFICATION_LABEL[key]} value={String(scorecard.byClassification[key])} />
              ))}
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Needs your attention"
          description="Every genuinely open advertising problem — including where a scaling opportunity is blocked by an unresolved compliance issue, which is never bypassed."
        />
        {advertisingPriorities.length === 0 ? (
          <EmptyState
            title={ceo.isDemo ? 'Demo mode' : 'Nothing needs you right now'}
            description={ceo.isDemo ? 'Demo mode has no live data to raise real priorities from — see the scenarios below for what this looks like with genuine problems.' : 'No campaign is currently wasting spend, underperforming, or otherwise flagged.'}
          />
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {advertisingPriorities.map((p) => <PriorityRow key={p.id} priority={p} />)}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Campaign performance" description="Every campaign with advertising data in the last 30 days, worst first." />
        {campaigns.length === 0 ? (
          <EmptyState
            title={ceo.isDemo ? 'Demo mode' : 'No advertising data yet'}
            description={ceo.isDemo ? 'See the demo scenarios below.' : 'Campaign figures appear once spend and revenue data starts flowing through a connected channel.'}
          />
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {campaigns.map((c) => <CampaignRow key={c.fact.identity.campaignKey} campaign={c} />)}
          </ul>
        )}
      </Card>

      <Card className="border-accent/30 bg-accent-soft">
        <div className="px-5 py-4">
          <p className="text-sm font-medium text-accent">How a recommendation becomes a decision</p>
          <p className="mt-1 text-sm text-ink">
            Nothing on this page can pause a campaign or change a budget directly. {anyConnected
              ? 'A platform is connected, but every campaign action still always requires your approval before anything is sent to it — no automated spend-changing action executes without that approval, this milestone.'
              : 'No advertising platform is actually connected in this environment (see above), so there is genuinely nothing to send an action to yet.'} The
            one real path today is: ask <Link href="/chat" className="underline hover:opacity-80">Commerce Intelligence chat</Link> to
            review a specific campaign by name; if it matches a real campaign, chat raises it as a proposal, which
            appears on <Link href="/approvals" className="underline hover:opacity-80">Approvals</Link> awaiting your decision. Nothing is
            auto-approved or auto-executed.
          </p>
        </div>
      </Card>

      {ceo.isDemo && advertisingIntelligence.demoScenarios.length > 0 ? (
        <>
          <Card className="border-demo/30 bg-demo-soft">
            <div className="px-5 py-4">
              <p className="text-sm text-demo">
                Demo mode has no database, so every figure above is a real, honest empty state. Every scenario below
                runs the real classification engine against deliberately chosen facts.
              </p>
            </div>
          </Card>
          <div className="grid gap-4">
            {advertisingIntelligence.demoScenarios.map((scenario) => (
              <Card key={scenario.key}>
                <CardHeader title={scenario.label} description={scenario.description} />
                <ul className="space-y-1 border-t border-border px-5 py-4 text-xs text-ink-muted">
                  {scenario.narrative.map((line, i) => <li key={i}>{line}</li>)}
                </ul>
              </Card>
            ))}
          </div>
        </>
      ) : null}
    </>
  )
}
