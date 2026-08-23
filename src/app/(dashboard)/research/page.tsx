import { Badge, Card, CardHeader, PageHeader, type Tone } from '@/components/ui'
import { getResearchProviders } from '@/lib/research/repository'

export const dynamic = 'force-dynamic'

const STATUS_TONES: Record<string, Tone> = {
  healthy: 'positive',
  ready: 'accent',
  degraded: 'caution',
  rate_limited: 'caution',
  failing: 'negative',
  disabled: 'neutral',
  not_configured: 'neutral',
}

const SOURCE_LABELS: Record<string, string> = {
  official_api: 'Official API',
  licensed_dataset: 'Licensed dataset',
  permitted_public: 'Permitted public data',
  supplier_feed: 'Supplier feed',
  manual_entry: 'Manual entry',
  simulated: 'Simulated',
}

export default async function ResearchPage() {
  const providers = await getResearchProviders()
  const active = providers.filter((p) => p.isConfigured && p.isEnabled)

  return (
    <>
      <PageHeader
        title="Research providers"
        description="Where product candidates come from. Each provider is a separate, independently configured source, and each one records what it is permitted to do."
      />

      <Card className="border-accent/30 bg-accent-soft">
        <div className="px-5 py-4">
          <p className="text-sm font-medium text-accent">How sourcing works here</p>
          <p className="mt-1 max-w-3xl text-sm text-ink">
            Research uses official APIs, licensed datasets and sources whose terms permit this use.
            The provider interface has no way to fetch an arbitrary URL and no HTML parsing, so a
            provider that would need to scrape a site that forbids it cannot be written against this
            architecture. Authentication, rate limits, robots directives and access controls are
            honoured because they are declared up front, not discovered by being blocked.
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            {active.length} of {providers.length} providers are active.
          </p>
        </div>
      </Card>

      <div className="grid gap-4">
        {providers.map((provider) => (
          <Card key={provider.key}>
            <CardHeader
              title={provider.label}
              description={provider.description}
              action={
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={STATUS_TONES[provider.status] ?? 'neutral'}>
                    {provider.status.replace(/_/g, ' ')}
                  </Badge>
                  <Badge tone={provider.sourceType === 'simulated' ? 'demo' : 'neutral'}>
                    {SOURCE_LABELS[provider.sourceType] ?? provider.sourceType}
                  </Badge>
                </div>
              }
            />

            <div className="px-5 py-4">
              <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">
                Permitted use
              </p>
              <p className="mt-1 max-w-3xl text-sm text-ink-muted">{provider.permittedUseNote}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone={provider.respectsRobots ? 'positive' : 'negative'}>
                  {provider.respectsRobots ? 'Honours robots directives' : 'Does not honour robots'}
                </Badge>
                <Badge tone={provider.authenticatedFirstParty ? 'positive' : 'neutral'}>
                  {provider.authenticatedFirstParty
                    ? 'Our own credentials'
                    : 'Not a first-party authenticated source'}
                </Badge>
                {provider.termsUrl ? (
                  <a
                    href={provider.termsUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-xs text-accent hover:underline"
                  >
                    Terms
                  </a>
                ) : null}
              </div>
            </div>

            <dl className="grid gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              <div className="bg-surface px-5 py-3">
                <dt className="text-xs text-ink-subtle">Rate limit</dt>
                <dd className="mt-0.5 text-sm">
                  {provider.rateLimitPerMinute === null && provider.rateLimitPerDay === null
                    ? 'None declared'
                    : [
                        provider.rateLimitPerMinute ? `${provider.rateLimitPerMinute}/min` : null,
                        provider.rateLimitPerDay ? `${provider.rateLimitPerDay}/day` : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                </dd>
              </div>
              <div className="bg-surface px-5 py-3">
                <dt className="text-xs text-ink-subtle">Minimum gap between runs</dt>
                <dd className="tabular mt-0.5 text-sm">{provider.minSecondsBetweenRuns}s</dd>
              </div>
              <div className="bg-surface px-5 py-3">
                <dt className="text-xs text-ink-subtle">Last success</dt>
                <dd className="mt-0.5 text-sm">{provider.lastSuccessAt ?? 'Never run'}</dd>
              </div>
              <div className="bg-surface px-5 py-3">
                <dt className="text-xs text-ink-subtle">Last failure</dt>
                <dd className="mt-0.5 text-sm">
                  {provider.lastFailureAt ?? 'None'}
                  {provider.consecutiveFailures > 0 ? ` (${provider.consecutiveFailures} in a row)` : ''}
                </dd>
              </div>
            </dl>

            {provider.missingCredentials.length > 0 ? (
              <div className="border-t border-border px-5 py-3">
                <p className="text-xs font-medium text-ink-subtle">Required environment variables</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {provider.missingCredentials.map((name) => (
                    <li key={name}>
                      <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-ink-muted">
                        {name}
                      </code>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {provider.lastError ? (
              <div className="border-t border-negative/25 bg-negative-soft px-5 py-3">
                <p className="text-sm text-ink">{provider.lastError}</p>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
    </>
  )
}
