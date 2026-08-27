import Link from 'next/link'
import type { Metadata } from 'next'
import { getCurrentCart } from '../../cart'
import { CartLineRow } from '../../_components/CartLineRow'
import { PriceDisplay } from '../../_components/PriceDisplay'
import { EmptyState } from '../../_components/EmptyState'

export const metadata: Metadata = { title: 'Your bag' }

export default async function CartPage() {
  const cart = await getCurrentCart()

  if (!cart || cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6 lg:px-8">
        <EmptyState title="Your bag is empty" reason="Add something you like and it'll show up here." />
        <div className="mt-6 text-center">
          <Link href="/shop" className="text-sm text-[var(--store-ink)] underline">
            Continue shopping
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1 className="font-display text-2xl text-[var(--store-ink)]">Your bag</h1>

      <div className="mt-6">
        {cart.lines.map((line) => (
          <CartLineRow key={line.id} cartId={cart.id} line={line} />
        ))}
      </div>

      <div className="mt-8 space-y-3 border-t border-[var(--store-border)] pt-6">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--store-ink-muted)]">Subtotal</span>
          <PriceDisplay price={cart.cost.subtotalAmount} size="lg" />
        </div>
        <p className="text-xs text-[var(--store-ink-subtle)]">Shipping and taxes calculated at checkout.</p>

        <a
          href={cart.checkoutUrl}
          className="mt-4 block w-full rounded-full bg-[var(--store-ink)] py-3.5 text-center text-sm font-medium text-[var(--store-ink-inverse)] transition-colors hover:bg-[var(--store-accent)]"
        >
          Checkout
        </a>
        <p className="text-center text-xs text-[var(--store-ink-subtle)]">Checkout is completed securely on Shopify.</p>
      </div>
    </div>
  )
}
