'use client'

export function CollectionSortSelect({ options, current }: { options: readonly { key: string; label: string }[]; current: string }) {
  return (
    <form>
      <select
        name="sort"
        defaultValue={current}
        onChange={(e) => e.currentTarget.form?.submit()}
        className="rounded-full border border-[var(--store-border-strong)] bg-[var(--store-canvas-raised)] px-4 py-2 text-sm text-[var(--store-ink)]"
      >
        {options.map((opt) => (
          <option key={opt.key} value={opt.key}>
            {opt.label}
          </option>
        ))}
      </select>
    </form>
  )
}
