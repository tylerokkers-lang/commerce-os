import Link from 'next/link'
import { Card, PageHeader } from '@/components/ui'
import { canWrite, requireSession } from '@/lib/security/session'
import { SupplierForm } from '../SupplierForm'

export const dynamic = 'force-dynamic'

export default async function NewSupplierPage() {
  const session = await requireSession()

  return (
    <>
      <div>
        <Link href="/suppliers" className="text-sm text-accent hover:underline">← All suppliers</Link>
      </div>

      <PageHeader
        title="Add supplier"
        description="Channel status is derived from the capability flags rather than set by hand, so a supplier cannot be marked approved for Amazon while lacking what Amazon requires."
      />

      {session.isDemo ? (
        <Card className="border-demo/30 bg-demo-soft">
          <div className="px-5 py-4">
            <p className="text-sm text-demo">
              Demo mode has no database. The form validates and the capability assessment runs for
              real, and the result is reported back to you, but nothing is stored.
            </p>
          </div>
        </Card>
      ) : null}

      <SupplierForm
        supplier={{
          typical_delivery_days_min: 2,
          typical_delivery_days_max: 5,
          returns_window_days: 30,
          orders_placed: 0,
          orders_late: 0,
          orders_defective: 0,
        }}
        canEdit={canWrite(session)}
      />
    </>
  )
}
