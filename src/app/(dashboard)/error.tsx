'use client'

/**
 * A general safety net (Milestone: live infrastructure activation, Phase
 * 11) — no `error.tsx` existed anywhere in this application before this,
 * so any unhandled error inside the dashboard rendered Next.js's own
 * default crash screen. The live-mode-specific "database connection
 * unavailable" message is handled earlier, server-side, in
 * `(dashboard)/layout.tsx` (before Next.js's client-side error
 * redaction would strip its detail in production) — this boundary is
 * only the fallback for everything else, and never claims to know more
 * about the cause than it genuinely does.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-lg rounded-xl border border-negative/40 bg-negative/10 px-6 py-5">
        <p className="text-sm font-semibold text-negative">Something went wrong</p>
        <p className="mt-2 text-sm text-ink-muted">
          An unexpected error stopped this page from rendering. Nothing has been silently hidden or
          replaced with fallback data.
        </p>
        {error.digest ? <p className="mt-3 text-xs text-ink-subtle">Reference: {error.digest}</p> : null}
        <button
          type="button"
          onClick={() => reset()}
          className="mt-4 rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium text-ink"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
