/**
 * Shown whenever the Storefront API isn't configured, or returns nothing —
 * never a fabricated product grid. `reason` should be honest and specific;
 * this is a customer-facing surface, but the site owner is often the one
 * who sees it first, while getting the store connected.
 */
export function EmptyState({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-[var(--store-radius-lg)] border border-[var(--store-border)] bg-[var(--store-canvas-raised)] px-8 py-16 text-center">
      <h2 className="font-display text-xl text-[var(--store-ink)]">{title}</h2>
      <p className="text-sm text-[var(--store-ink-muted)]">{reason}</p>
    </div>
  )
}
