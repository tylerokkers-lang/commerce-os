import Link from 'next/link'
import { getCurrentCart } from '../cart'

export async function CartBadge() {
  const cart = await getCurrentCart()
  const count = cart?.totalQuantity ?? 0

  return (
    <Link
      href="/shop/cart"
      aria-label={`Bag, ${count} item${count === 1 ? '' : 's'}`}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--store-ink)] transition-colors hover:bg-[var(--store-surface-sunken)]"
    >
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M6 8h12l-1 12H7L6 8Z" strokeLinejoin="round" />
        <path d="M9 8V6a3 3 0 0 1 6 0v2" strokeLinecap="round" />
      </svg>
      {count > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--store-accent)] px-1 text-[10px] font-medium text-white">
          {count}
        </span>
      ) : null}
    </Link>
  )
}
