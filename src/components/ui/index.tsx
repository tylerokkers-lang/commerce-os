import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Small, shared primitives. Kept in one file while the set is this small. */

export function Card({
  children,
  className,
  as: Tag = 'section',
}: {
  children: ReactNode
  className?: string
  as?: 'section' | 'div' | 'article'
}) {
  return (
    <Tag className={cn('rounded-xl border border-border bg-surface', className)}>{children}</Tag>
  )
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-ink-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export type Tone = 'neutral' | 'accent' | 'positive' | 'caution' | 'negative' | 'demo'

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-ink-muted border-border',
  accent: 'bg-accent-soft text-accent border-accent/25',
  positive: 'bg-positive-soft text-positive border-positive/25',
  caution: 'bg-caution-soft text-caution border-caution/30',
  negative: 'bg-negative-soft text-negative border-negative/25',
  demo: 'bg-demo-soft text-demo border-demo/25',
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: Tone
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function StatTile({
  label,
  value,
  sublabel,
  change,
  tone = 'neutral',
}: {
  label: string
  value: string
  sublabel?: string
  change?: number | null
  tone?: Tone
}) {
  return (
    <Card as="div" className="px-4 py-3.5">
      <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">{label}</p>
      <p className={cn('tabular mt-1.5 text-2xl font-semibold', tone === 'negative' && 'text-negative', tone === 'positive' && 'text-positive')}>
        {value}
      </p>
      <div className="mt-1 flex items-center gap-2">
        {sublabel ? <span className="text-xs text-ink-muted">{sublabel}</span> : null}
        {change !== null && change !== undefined ? (
          <span
            className={cn(
              'tabular text-xs font-medium',
              change > 0 ? 'text-positive' : change < 0 ? 'text-negative' : 'text-ink-subtle',
            )}
          >
            {change > 0 ? '+' : ''}
            {change.toFixed(1)}%
          </span>
        ) : null}
      </div>
    </Card>
  )
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{description}</p>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-ink-muted">{description}</p> : null}
      </div>
      {action}
    </header>
  )
}

/** Horizontal scroll is contained here so the page body never scrolls sideways. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>
}
