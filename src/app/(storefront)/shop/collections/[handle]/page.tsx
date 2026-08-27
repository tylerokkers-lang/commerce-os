import type { Metadata } from 'next'
import { getCollectionByHandle, isStorefrontConfigured, type CollectionSort } from '@/lib/shopify/storefront'
import { ProductGrid } from '../../../_components/ProductGrid'
import { EmptyState } from '../../../_components/EmptyState'
import { CollectionSortSelect } from '../../../_components/CollectionSortSelect'

const SORT_OPTIONS: { value: CollectionSort; reverse: boolean; label: string }[] = [
  { value: 'BEST_SELLING', reverse: false, label: 'Best selling' },
  { value: 'PRICE', reverse: false, label: 'Price: low to high' },
  { value: 'PRICE', reverse: true, label: 'Price: high to low' },
  { value: 'CREATED', reverse: true, label: 'Newest' },
]

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params
  return { title: handle.replace(/-/g, ' ') }
}

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>
  searchParams: Promise<{ sort?: string }>
}) {
  const { handle } = await params
  const { sort } = await searchParams

  if (!isStorefrontConfigured()) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <EmptyState title="Store not connected yet" reason="This storefront isn't connected to a Shopify store." />
      </div>
    )
  }

  const sortOption = SORT_OPTIONS.find((s) => `${s.value}${s.reverse ? '-desc' : ''}` === sort) ?? SORT_OPTIONS[0]
  const result = await getCollectionByHandle(handle, { sortKey: sortOption.value, reverse: sortOption.reverse, first: 48 })

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <EmptyState title="Couldn't load this collection" reason={result.error} />
      </div>
    )
  }

  if (!result.value) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <EmptyState title="Collection not found" reason={`There's no collection with the handle "${handle}".`} />
      </div>
    )
  }

  const { collection, products } = result.value

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-10 border-b border-[var(--store-border)] pb-8">
        <h1 className="font-display text-3xl text-[var(--store-ink)]">{collection.title}</h1>
        {collection.description ? <p className="mt-2 max-w-2xl text-sm text-[var(--store-ink-muted)]">{collection.description}</p> : null}
      </div>

      <div className="mb-6 flex items-center justify-between">
        <p className="text-sm text-[var(--store-ink-subtle)]">{products.length} product{products.length === 1 ? '' : 's'}</p>
        <CollectionSortSelect
          current={`${sortOption.value}${sortOption.reverse ? '-desc' : ''}`}
          options={SORT_OPTIONS.map((opt) => ({ key: `${opt.value}${opt.reverse ? '-desc' : ''}`, label: opt.label }))}
        />
      </div>

      <ProductGrid products={products} />
    </div>
  )
}
