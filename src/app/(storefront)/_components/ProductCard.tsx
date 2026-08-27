import Image from 'next/image'
import Link from 'next/link'
import type { StorefrontProductSummary } from '@/lib/shopify/storefront'
import { PriceDisplay } from './PriceDisplay'

export function ProductCard({ product }: { product: StorefrontProductSummary }) {
  const onSale = Boolean(product.compareAtPriceRange)

  return (
    <Link
      href={`/shop/products/${product.handle}`}
      className="group block"
    >
      <div className="relative aspect-[4/5] overflow-hidden rounded-[var(--store-radius-md)] bg-[var(--store-surface-sunken)] shadow-[var(--store-shadow-card)]">
        {product.featuredImage ? (
          <Image
            src={product.featuredImage.url}
            alt={product.featuredImage.altText ?? product.title}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            className="object-cover transition-transform duration-700 ease-[var(--store-ease)] group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--store-ink-subtle)] text-sm">No image</div>
        )}

        <div className="absolute left-3 top-3 flex flex-col gap-1.5">
          {onSale ? (
            <span className="rounded-full bg-[var(--store-sale)] px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-white">Sale</span>
          ) : null}
          {!product.availableForSale ? (
            <span className="rounded-full bg-[var(--store-ink)] px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-white">Sold out</span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-start justify-between gap-3">
        <h3 className="text-sm text-[var(--store-ink)] group-hover:text-[var(--store-accent)] transition-colors">{product.title}</h3>
      </div>
      <div className="mt-1">
        <PriceDisplay price={product.priceRange.min} compareAtPrice={product.compareAtPriceRange?.min} size="sm" />
      </div>
    </Link>
  )
}
