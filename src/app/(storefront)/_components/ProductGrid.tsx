import type { StorefrontProductSummary } from '@/lib/shopify/storefront'
import { ProductCard } from './ProductCard'
import { EmptyState } from './EmptyState'

export function ProductGrid({ products }: { products: readonly StorefrontProductSummary[] }) {
  if (products.length === 0) {
    return <EmptyState title="No products here yet" reason="This collection doesn't have any products in it right now." />
  }

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((product, i) => (
        <div key={product.id} className="store-fade-up" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
          <ProductCard product={product} />
        </div>
      ))}
    </div>
  )
}
