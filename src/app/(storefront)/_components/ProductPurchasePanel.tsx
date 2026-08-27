'use client'

import { useMemo, useState } from 'react'
import type { StorefrontProduct } from '@/lib/shopify/storefront'
import { PriceDisplay } from './PriceDisplay'
import { AddToCartButton } from './AddToCartButton'

/**
 * Owns variant selection. A product with a single default variant (no real
 * options) skips the option UI entirely rather than showing a pointless
 * one-choice selector.
 */
export function ProductPurchasePanel({ product }: { product: StorefrontProduct }) {
  const hasRealOptions = product.options.some((o) => o.name !== 'Title' && o.values.length > 1)

  const [selected, setSelected] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const option of product.options) {
      const firstAvailable = product.variants.find((v) => v.availableForSale)
      const fromFirstAvailable = firstAvailable?.selectedOptions.find((o) => o.name === option.name)?.value
      initial[option.name] = fromFirstAvailable ?? option.values[0]
    }
    return initial
  })

  const matchedVariant = useMemo(() => {
    return product.variants.find((variant) =>
      variant.selectedOptions.every((opt) => selected[opt.name] === opt.value),
    ) ?? null
  }, [product.variants, selected])

  return (
    <div>
      <div className="mt-2">
        <PriceDisplay price={matchedVariant?.price ?? product.priceRange.min} compareAtPrice={matchedVariant?.compareAtPrice ?? product.compareAtPriceRange?.min} size="lg" />
      </div>

      {hasRealOptions ? (
        <div className="mt-6 space-y-5">
          {product.options
            .filter((o) => o.name !== 'Title')
            .map((option) => (
              <div key={option.name}>
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--store-ink-subtle)]">{option.name}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {option.values.map((value) => {
                    const isActive = selected[option.name] === value
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSelected((prev) => ({ ...prev, [option.name]: value }))}
                        className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                          isActive
                            ? 'border-[var(--store-ink)] bg-[var(--store-ink)] text-[var(--store-ink-inverse)]'
                            : 'border-[var(--store-border-strong)] text-[var(--store-ink)] hover:border-[var(--store-ink)]'
                        }`}
                      >
                        {value}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
        </div>
      ) : null}

      <AddToCartButton variantId={matchedVariant?.id ?? null} available={matchedVariant?.availableForSale ?? false} />

      {!matchedVariant ? (
        <p className="mt-2 text-center text-xs text-[var(--store-ink-subtle)]">That combination isn&apos;t available.</p>
      ) : null}
    </div>
  )
}
