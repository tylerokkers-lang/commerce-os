import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui'
import { STAGE_LABELS, STAGE_TONES } from '@/lib/constants'
import { requireSession, canWrite } from '@/lib/security/session'
import { getProductDetail, getChannelReadinessList } from '@/lib/products/repository'
import { getProductIntelligence } from '@/lib/products/intelligence/repository'
import { DecisionControl } from '../DecisionControl'
import { ChannelDecisionControl } from '../ChannelDecisionControl'
import { ProductIntelligencePanel } from '../ProductIntelligencePanel'

export const dynamic = 'force-dynamic'

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [product, session] = await Promise.all([getProductDetail(id), requireSession()])
  if (!product) notFound()

  const channelRows = await getChannelReadinessList(product)
  const canEdit = canWrite(session) && !session.isDemo
  const intelligence = session.isDemo ? null : await getProductIntelligence(session.orgId, product.id)

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
        <DecisionControl product={product} canEdit={canEdit} />
      </Card>

      {session.isDemo ? (
        <Card>
          <CardHeader title="Product intelligence" description="Is this product actually worth selling?" />
          <div className="border-t border-border px-5 py-6">
            <EmptyState
              title="Not modelled in demo mode"
              description="Product intelligence needs real cost, supplier and listing data to reason from — demo mode has none of that to show honestly. Connect Supabase to see this populate."
            />
          </div>
        </Card>
      ) : (
        <Card>
          <ProductIntelligencePanel productId={product.id} data={intelligence} canEdit={canEdit} />
        </Card>
      )}

      <div>
        <h2 className="text-base font-semibold text-ink">Channel decisions</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-subtle">
          The product decision above applies everywhere. This product could still be sold on one
          channel while blocked on another — set that here. Each recommendation is derived
          deterministically from real facts, never guessed.
        </p>

        {session.isDemo ? (
          <Card className="mt-3">
            <EmptyState
              title="Not modelled in demo mode"
              description="Channel decisions need real per-channel listing, supplier and cost data to reason from — demo mode has none of that to show honestly. Connect Supabase to see this populate."
            />
          </Card>
        ) : (
          <div className="mt-3 grid gap-4">
            {channelRows.map((row) => (
              <Card key={row.channel}>
                <ChannelDecisionControl productId={product.id} row={row} canEdit={canEdit} />
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
