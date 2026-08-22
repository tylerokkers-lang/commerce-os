import { Badge, Card, EmptyState, PageHeader, TableWrap } from '@/components/ui'
import { formatDateTime, humaniseAction } from '@/lib/utils'
import { getAuditEvents } from '@/lib/audit/repository'
import type { AuditEvent } from '@/lib/core/domain'

export const dynamic = 'force-dynamic'

const ACTOR_LABELS: Record<AuditEvent['actorType'], string> = {
  user: 'Person',
  system: 'System',
  ai: 'AI',
  integration: 'Integration',
}

function resultTone(result: string) {
  return result === 'success' ? 'positive' : result === 'blocked' ? 'caution' : 'negative'
}

export default async function AuditPage() {
  const events = await getAuditEvents()

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every consequential action, automated or human, with the reason that triggered it. The log is append-only at the database level: entries cannot be edited or deleted, including by this application."
      />

      <Card>
        {events.length === 0 ? (
          <EmptyState title="No entries yet" description="Actions are recorded here as soon as the system starts doing things." />
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-ink-subtle">
                  <th className="px-5 py-2.5 font-medium">When</th>
                  <th className="px-3 py-2.5 font-medium">Actor</th>
                  <th className="px-3 py-2.5 font-medium">Action</th>
                  <th className="px-3 py-2.5 font-medium">Subject</th>
                  <th className="px-3 py-2.5 font-medium">Reason</th>
                  <th className="px-5 py-2.5 text-right font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-b border-border last:border-0 align-top">
                    <td className="tabular px-5 py-3 whitespace-nowrap text-ink-muted">
                      {formatDateTime(event.occurredAt)}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={event.actorType === 'ai' ? 'accent' : 'neutral'}>
                        {ACTOR_LABELS[event.actorType]}
                      </Badge>
                      {event.actorLabel ? (
                        <p className="mt-1 text-xs text-ink-subtle">{event.actorLabel}</p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 font-medium whitespace-nowrap">{humaniseAction(event.action)}</td>
                    <td className="px-3 py-3 text-ink-muted">
                      {event.entityType}
                      {event.entityId ? <span className="text-ink-subtle"> · {event.entityId}</span> : null}
                    </td>
                    <td className="max-w-sm px-3 py-3 text-ink-muted">{event.reason ?? '—'}</td>
                    <td className="px-5 py-3 text-right">
                      <Badge tone={resultTone(event.result)}>{event.result}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  )
}
