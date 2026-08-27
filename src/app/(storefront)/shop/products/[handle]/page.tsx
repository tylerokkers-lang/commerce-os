import type { Metadata } from 'next'
import { getProductByHandle, isStorefrontConfigured } from '@/lib/shopify/storefront'
import { ProductGallery } from '../../../_components/ProductGallery'
import { ProductPurchasePanel } from '../../../_components/ProductPurchasePanel'
import { EmptyState } from '../../../_components/EmptyState'

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params
  if (!isStorefrontConfigured()) return { title: handle }
  const result = await getProductByHandle(handle)
  if (!result.ok || !result.value) return { title: handle }
  return {
    title: result.value.title,
    description: result.value.description.slice(0, 160),
    openGraph: result.value.featuredImage ? { images: [result.value.featuredImage.url] } : undefined,
  }
}

export default async function ProductPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params

  if (!isStorefrontConfigured()) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <EmptyState title="Store not connected yet" reason="This storefront isn't connected to a Shopify store." />
      </div>
    )
  }

  const result = await getProductByHandle(handle)

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <EmptyState title="Couldn't load this product" reason={result.error} />
      </div>
    )
  }

  if (!result.value) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <EmptyState title="Product not found" reason={`There's no product with the handle "${handle}".`} />
      </div>
    )
  }

  const product = result.value

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
        <ProductGallery images={product.images.length > 0 ? product.images : product.featuredImage ? [product.featuredImage] : []} title={product.title} />

        <div className="lg:sticky lg:top-24 lg:self-start">
          <h1 className="font-display text-3xl text-[var(--store-ink)]">{product.title}</h1>

          <ProductPurchasePanel product={product} />

          {product.description ? (
            <div className="mt-10 border-t border-[var(--store-border)] pt-8">
              <h2 className="text-xs font-medium uppercase tracking-wide text-[var(--store-ink-subtle)]">Description</h2>
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-[var(--store-ink-muted)]">{product.description}</p>
            </div>
          ) : null}

          {product.tags.length > 0 ? (
            <div className="mt-8 flex flex-wrap gap-2">
              {product.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-[var(--store-surface-sunken)] px-3 py-1 text-xs text-[var(--store-ink-muted)]">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
