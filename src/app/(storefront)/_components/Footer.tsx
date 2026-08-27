import { STORE_NAME } from './storeConfig'

/**
 * No newsletter signup here yet: an email-capture form is easy to fake with
 * a client-side "Thanks, you're on the list!" message and no backend at
 * all — exactly the kind of fake success message this project's build
 * instructions rule out. It belongs here once a real email provider (a
 * Klaviyo/Mailchimp/Resend-audience list) is actually connected; until
 * then, showing nothing is more honest than showing something that quietly
 * discards every email address typed into it.
 */
export function Footer() {
  return (
    <footer className="mt-24 border-t border-[var(--store-border)] bg-[var(--store-surface-sunken)]">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div>
            <h4 className="text-xs font-medium uppercase tracking-wide text-[var(--store-ink-subtle)]">Shop</h4>
            <ul className="mt-3 space-y-2 text-sm text-[var(--store-ink-muted)]">
              <li><a href="/shop" className="hover:text-[var(--store-ink)]">All products</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-medium uppercase tracking-wide text-[var(--store-ink-subtle)]">Help</h4>
            <ul className="mt-3 space-y-2 text-sm text-[var(--store-ink-muted)]">
              <li><span className="cursor-default">Shipping &amp; delivery</span></li>
              <li><span className="cursor-default">Returns</span></li>
              <li><span className="cursor-default">Contact us</span></li>
            </ul>
          </div>
          <div className="col-span-2 sm:col-span-2">
            <h4 className="text-xs font-medium uppercase tracking-wide text-[var(--store-ink-subtle)]">{STORE_NAME}</h4>
            <p className="mt-3 max-w-sm text-sm text-[var(--store-ink-muted)]">
              Carefully chosen products, shipped directly from source. We check every item before it goes on sale.
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-[var(--store-border)] pt-6 text-xs text-[var(--store-ink-subtle)] sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} {STORE_NAME}. All rights reserved.</span>
        </div>
      </div>
    </footer>
  )
}
