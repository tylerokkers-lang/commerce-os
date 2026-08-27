'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { StorefrontImage } from '@/lib/shopify/storefront'

export function ProductGallery({ images, title }: { images: readonly StorefrontImage[]; title: string }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const active = images[activeIndex] ?? null

  if (images.length === 0) {
    return (
      <div className="aspect-square rounded-[var(--store-radius-lg)] bg-[var(--store-surface-sunken)] flex items-center justify-center text-sm text-[var(--store-ink-subtle)]">
        No image
      </div>
    )
  }

  return (
    <div>
      <div className="aspect-square overflow-hidden rounded-[var(--store-radius-lg)] bg-[var(--store-surface-sunken)] shadow-[var(--store-shadow-card)]">
        {active ? (
          <Image
            key={active.url}
            src={active.url}
            alt={active.altText ?? title}
            width={900}
            height={900}
            priority
            className="h-full w-full object-cover store-fade-up"
          />
        ) : null}
      </div>

      {images.length > 1 ? (
        <div className="mt-3 grid grid-cols-5 gap-3">
          {images.map((image, i) => (
            <button
              key={image.url}
              type="button"
              onClick={() => setActiveIndex(i)}
              aria-label={`Show image ${i + 1}`}
              className={`aspect-square overflow-hidden rounded-[var(--store-radius-sm)] bg-[var(--store-surface-sunken)] transition-opacity ${
                i === activeIndex ? 'ring-2 ring-[var(--store-ink)]' : 'opacity-70 hover:opacity-100'
              }`}
            >
              <Image src={image.url} alt={image.altText ?? title} width={160} height={160} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
