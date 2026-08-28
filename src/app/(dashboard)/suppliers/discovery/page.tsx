import { Card, CardHeader, EmptyState, PageHeader } from '@/components/ui'
import { requireSession } from '@/lib/security/session'
import { getDiscoveryQueue } from '@/lib/suppliers/discovery/repository'
import { getSuppliers } from '@/lib/suppliers/repository'
import { CaptureCandidateForm } from './CaptureCandidateForm'
import { QueueRow } from './QueueRow'

export const dynamic = 'force-dynamic'

export default async function SupplierDiscoveryPage() {
  const session = await requireSession()

  if (session.isDemo) {
    return (
      <>
        <PageHeader
          title="Supplier discovery"
          description="Capture products from suppliers, check for duplicates, and hand them to product intelligence — never automatically published or purchased."
        />
        <Card>
          <EmptyState
            title="Not modelled in demo mode"
            description="Supplier discovery writes real candidates and real products — demo mode has no database to show this honestly. Connect Supabase to use it."
          />
        </Card>
      </>
    )
  }

  const [queue, suppliers] = await Promise.all([getDiscoveryQueue(), getSuppliers()])
  const pending = queue.filter((c) => c.status === 'new' || c.status === 'duplicate')

  return (
    <>
      <PageHeader
        title="Supplier discovery"
        description="Capture products from suppliers, check for duplicates, and hand them to product intelligence — never automatically published or purchased."
      />

      <Card>
        <CardHeader title="Capture a candidate" description="The manual entry workflow — every future connector's discovery output would land here the same way." />
        <CaptureCandidateForm suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))} />
      </Card>

      <Card>
        <CardHeader
          title="Discovery queue"
          description={`${pending.length} candidate${pending.length === 1 ? '' : 's'} awaiting a decision.`}
        />
        {queue.length === 0 ? (
          <div className="border-t border-border px-5 py-6">
            <EmptyState title="No candidates yet" description="Capture one above to get started." />
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border text-xs font-medium uppercase tracking-wide text-ink-subtle">
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Supplier</th>
                  <th className="px-3 py-2">Cost</th>
                  <th className="px-3 py-2">Shipping</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((candidate) => (
                  <QueueRow key={candidate.id} candidate={candidate} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
