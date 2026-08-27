/**
 * Deliberately generic — no specific shipping cost, delivery time, or
 * returns-window claim, since none of those are configured anywhere in
 * this system yet (@/lib/fulfilment has no store-facing policy values to
 * read). Replace these three lines with real, configured policy text once
 * shipping/returns terms exist — never with a plausible-sounding guess.
 */
const POINTS = [
  { title: 'Considered selection', body: 'Every product is reviewed before it goes on sale.' },
  { title: 'Direct from source', body: 'No unnecessary markup from sitting in a warehouse.' },
  { title: 'Real support', body: 'A person reads every message.' },
]

export function TrustSection() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
      <div className="grid grid-cols-1 gap-8 border-y border-[var(--store-border)] py-10 sm:grid-cols-3">
        {POINTS.map((p) => (
          <div key={p.title} className="text-center sm:text-left">
            <h3 className="font-display text-lg text-[var(--store-ink)]">{p.title}</h3>
            <p className="mt-1.5 text-sm text-[var(--store-ink-muted)]">{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
