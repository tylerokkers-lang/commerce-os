import { formatStorefrontMoney, type StorefrontMoney } from '@/lib/shopify/storefront'

export function PriceDisplay({
  price,
  compareAtPrice,
  size = 'md',
}: {
  price: StorefrontMoney
  compareAtPrice?: StorefrontMoney | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const onSale = Boolean(compareAtPrice && Number(compareAtPrice.amount) > Number(price.amount))
  const sizeClass = size === 'lg' ? 'text-2xl' : size === 'sm' ? 'text-sm' : 'text-base'

  return (
    <span className="inline-flex items-baseline gap-2">
      <span className={`font-medium ${sizeClass} ${onSale ? 'text-[var(--store-sale)]' : 'text-[var(--store-ink)]'}`}>
        {formatStorefrontMoney(price)}
      </span>
      {onSale && compareAtPrice ? (
        <span className="text-[var(--store-ink-subtle)] line-through text-sm">{formatStorefrontMoney(compareAtPrice)}</span>
      ) : null}
    </span>
  )
}
