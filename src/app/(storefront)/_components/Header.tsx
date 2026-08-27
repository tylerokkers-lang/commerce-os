import Link from 'next/link'
import { getAllCollections } from '@/lib/shopify/storefront'
import { STORE_NAME } from './storeConfig'
import { CartBadge } from './CartBadge'

export async function Header() {
  const collections = await getAllCollections(5)
  const navCollections = collections.ok ? collections.value : []

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--store-border)] bg-[var(--store-canvas)]/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/shop" className="font-display text-xl tracking-tight text-[var(--store-ink)]">
          {STORE_NAME}
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {navCollections.map((c) => (
            <Link
              key={c.id}
              href={`/shop/collections/${c.handle}`}
              className="text-sm text-[var(--store-ink-muted)] transition-colors hover:text-[var(--store-ink)]"
            >
              {c.title}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1">
          <CartBadge />
        </div>
      </div>
    </header>
  )
}
