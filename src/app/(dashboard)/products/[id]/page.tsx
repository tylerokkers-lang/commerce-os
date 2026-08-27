import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui'
import { STAGE_LABELS, STAGE_TONES } from '@/lib/constants'
import { requireSession, canWrite } from '@/lib/security/session'
import { getProductDetail } from '@/lib/products/repository'
import { DecisionControl } from '../DecisionControl'

export const dynamic = 'force-dynamic'

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [product, session] = await Promise.all([getProductDetail(id), requireSession()])
  if (!product) notFound()

  return (
    <>
      <div>
        <Link href="/products" className="text-sm text-accent hover:underline">← All products</Link>
      </div>

      <PageHeader title={product.title} description={product.category ?? undefined} />

      {/*
        Deliberately two separate cards. The product's own facts (left/top)
        and the Commerce-OS decision (below) are NOT the same thing — the
        decision is never derived from, and never overwrites, any of these.
      */}
      <Card>
        <CardHeader title="Product" description="What Commerce-OS currently knows about this product." />
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-ink-subtle">SKU</p>
            <p className="text-sm font-medium text-ink">{product.sku}</p>
          </div>
          <div>
            <p className="text-sm text-ink-subtle">Lifecycle stage</p>
            <Badge tone={STAGE_TONES[product.stage as keyof typeof STAGE_TONES]}>
              {STAGE_LABELS[product.stage as keyof typeof STAGE_LABELS] ?? product.stage}
            </Badge>
            <p className="mt-1 text-xs text-ink-subtle">
              A discovery-to-trading pipeline position — distinct from the Commerce-OS decision below.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <DecisionControl product={product} canEdit={canWrite(session) && !session.isDemo} />
      </Card>
    </>
  )
}
