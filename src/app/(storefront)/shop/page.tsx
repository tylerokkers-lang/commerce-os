import type { Metadata } from 'next'
import { getAllCollections, getFeaturedProducts, isStorefrontConfigured } from '@/lib/shopify/storefront'
import { Hero } from '../_components/Hero'
import { TrustSection } from '../_components/TrustSection'
import { ProductGrid } from '../_components/ProductGrid'
import { EmptyState } from '../_components/EmptyState'
import { STORE_NAME } from '../_components/storeConfig'

export const metadata: Metadata = {
  title: STORE_NAME,
  description: `Shop ${STORE_NAME}.`,
}

export default async function StorefrontHomePage() {
  if (!isStorefrontConfigured()) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <EmptyState
          title="Store not connected yet"
          reason="This storefront isn't connected to a Shopify store. Set SHOPIFY_STORE_DOMAIN, SHOPIFY_STOREFRONT_ACCESS_TOKEN and SHOPIFY_API_VERSION to bring it live — see .env.example."
        />
      </div>
    )
  }

  const [featured, collections] = await Promise.all([getFeaturedProducts(8), getAllCollections(1)])
  const products = featured.ok ? featured.value : []
  const primaryCollectionHref = collections.ok && collections.value[0] ? `/shop/collections/${collections.value[0].handle}` : '/shop'

  return (
    <>
      <Hero featuredProduct={products[0] ?? null} primaryCollectionHref={primaryCollectionHref} />
      <TrustSection />
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-end justify-between">
          <h2 className="font-display text-2xl text-[var(--store-ink)]">Featured</h2>
        </div>
        {featured.ok ? (
          <ProductGrid products={products} />
        ) : (
          <EmptyState title="Couldn't load products" reason={featured.error} />
        )}
      </section>
    </>
  )
}
