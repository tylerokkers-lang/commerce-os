import Link from 'next/link'
import Image from 'next/image'
import type { StorefrontProductSummary } from '@/lib/shopify/storefront'

export function Hero({
  featuredProduct,
  primaryCollectionHref,
}: {
  featuredProduct: StorefrontProductSummary | null
  primaryCollectionHref: string
}) {
  return (
    <section className="relative overflow-hidden bg-[var(--store-canvas-raised)]">
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-24">
        <div className="store-fade-up order-2 lg:order-1">
          <h1 className="font-display text-4xl leading-[1.08] text-[var(--store-ink)] sm:text-5xl lg:text-6xl">
            Things worth
            <br />
            keeping.
          </h1>
          <p className="mt-6 max-w-md text-base text-[var(--store-ink-muted)]">
            A small, considered selection — chosen for quality and value, not just volume. New arrivals every week.
          </p>
          <div className="mt-8 flex items-center gap-4">
            <Link
              href={primaryCollectionHref}
              className="inline-flex items-center rounded-full bg-[var(--store-ink)] px-7 py-3.5 text-sm font-medium text-[var(--store-ink-inverse)] transition-colors hover:bg-[var(--store-accent)]"
            >
              Shop the collection
            </Link>
          </div>
        </div>

        <div className="order-1 aspect-[4/5] overflow-hidden rounded-[var(--store-radius-lg)] bg-[var(--store-surface-sunken)] shadow-[var(--store-shadow-raised)] lg:order-2">
          {featuredProduct?.featuredImage ? (
            <Image
              src={featuredProduct.featuredImage.url}
              alt={featuredProduct.featuredImage.altText ?? featuredProduct.title}
              width={800}
              height={1000}
              priority
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[var(--store-ink-subtle)] text-sm">
              Store not connected yet
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
