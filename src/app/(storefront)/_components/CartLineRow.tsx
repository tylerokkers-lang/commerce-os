'use client'

import { useTransition } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import type { StorefrontCartLine } from '@/lib/shopify/storefront'
import { PriceDisplay } from './PriceDisplay'
import { updateCartLine, removeCartLine } from '../actions'

export function CartLineRow({ cartId, line }: { cartId: string; line: StorefrontCartLine }) {
  const [isPending, startTransition] = useTransition()

  return (
    <div className="flex gap-4 border-b border-[var(--store-border)] py-6">
      <Link href={`/shop/products/${line.merchandise.product.handle}`} className="h-24 w-20 shrink-0 overflow-hidden rounded-[var(--store-radius-sm)] bg-[var(--store-surface-sunken)]">
        {line.merchandise.image ? (
          <Image src={line.merchandise.image.url} alt={line.merchandise.image.altText ?? line.merchandise.product.title} width={160} height={192} className="h-full w-full object-cover" />
        ) : null}
      </Link>

      <div className="flex flex-1 flex-col justify-between">
        <div>
          <Link href={`/shop/products/${line.merchandise.product.handle}`} className="text-sm text-[var(--store-ink)] hover:text-[var(--store-accent)]">
            {line.merchandise.product.title}
          </Link>
          {line.merchandise.title !== 'Default Title' ? (
            <p className="text-xs text-[var(--store-ink-subtle)]">{line.merchandise.title}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 rounded-full border border-[var(--store-border-strong)]">
            <button
              type="button"
              disabled={isPending}
              onClick={() => startTransition(async () => { await updateCartLine(cartId, line.id, line.quantity - 1) })}
              className="h-8 w-8 text-sm text-[var(--store-ink)] disabled:opacity-40"
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span className="w-4 text-center text-sm tabular-nums">{line.quantity}</span>
            <button
              type="button"
              disabled={isPending}
              onClick={() => startTransition(async () => { await updateCartLine(cartId, line.id, line.quantity + 1) })}
              className="h-8 w-8 text-sm text-[var(--store-ink)] disabled:opacity-40"
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>

          <button
            type="button"
            disabled={isPending}
            onClick={() => startTransition(async () => { await removeCartLine(cartId, line.id) })}
            className="text-xs text-[var(--store-ink-subtle)] underline hover:text-[var(--store-sale)] disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      </div>

      <PriceDisplay price={line.merchandise.price} />
    </div>
  )
}
