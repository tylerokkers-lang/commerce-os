import { err, ok, type Result } from '@/lib/core/result'

/**
 * The Shopify Storefront API connector — powers the customer-facing headless
 * store (`src/app/(storefront)`). Deliberately separate from
 * `src/lib/marketplaces/connectors/shopify.ts` (the Admin API connector the
 * rest of Commerce OS uses to read orders/products into the operator
 * dashboard): different credential (`SHOPIFY_STOREFRONT_ACCESS_TOKEN`, a
 * public-safe token scoped to catalogue-read + cart-write only), different
 * API surface, different purpose. Nothing in this file can read an order, a
 * customer record, or write a product — the Storefront API is structurally
 * incapable of any of that, which is exactly why it's the right credential
 * for code that ends up serving real shoppers.
 *
 * IMPLEMENTED, NOT LIVE-VERIFIED: every query/mutation below is written
 * against Shopify's current published Storefront API reference and has
 * never been run against a real store — no Storefront API token exists in
 * this environment. Every call is gated behind `isStorefrontConfigured()`;
 * without `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_ACCESS_TOKEN` and
 * `SHOPIFY_API_VERSION` this module makes no network call of any kind, and
 * every page that calls it renders an explicit "store not connected" state
 * rather than fabricating products.
 *
 * Money is deliberately NOT converted into this codebase's minor-units
 * `Money` type (`@/lib/core/money`) here — that type exists for figures
 * that feed the profitability/accounting engines, and Storefront API prices
 * never do (a customer-facing display price is not a cost, fee, or ledger
 * entry). Prices stay as the API's own `{ amount: string; currencyCode }`
 * shape and are formatted for display only, via `formatStorefrontMoney`
 * below.
 */

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim().length > 0 ? value.trim() : undefined
}

function normalizeStoreDomain(value: string): string {
  return value.replace(/^(?:https?:\/*)+/i, '').replace(/\/+$/, '')
}

interface StorefrontCredentials {
  storeDomain: string
  accessToken: string
  apiVersion: string
}

function credentials(): StorefrontCredentials | null {
  const rawStoreDomain = readEnv('SHOPIFY_STORE_DOMAIN')
  const accessToken = readEnv('SHOPIFY_STOREFRONT_ACCESS_TOKEN')
  const apiVersion = readEnv('SHOPIFY_API_VERSION')
  if (!rawStoreDomain || !accessToken || !apiVersion) return null
  return { storeDomain: normalizeStoreDomain(rawStoreDomain), accessToken, apiVersion }
}

export function isStorefrontConfigured(): boolean {
  return credentials() !== null
}

interface StorefrontGraphqlError {
  message: string
}

interface StorefrontGraphqlEnvelope<T> {
  data?: T
  errors?: readonly StorefrontGraphqlError[]
}

async function storefrontGraphql<T>(query: string, variables?: Record<string, unknown>): Promise<Result<T, string>> {
  const creds = credentials()
  if (!creds) return err('Shopify Storefront API is not configured — SHOPIFY_STORE_DOMAIN, SHOPIFY_STOREFRONT_ACCESS_TOKEN and SHOPIFY_API_VERSION must all be set.')

  let response: Response
  try {
    response = await fetch(`https://${creds.storeDomain}/api/${creds.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': creds.accessToken,
      },
      body: JSON.stringify({ query, variables }),
      // Public catalogue data — cached briefly rather than refetched on every
      // request, but short enough that a price/stock change on the store
      // shows up quickly. Cart requests bypass this entirely (see below).
      next: { revalidate: 60 },
    })
  } catch (error) {
    return err(`Shopify Storefront API request threw: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    return err(`Shopify Storefront API request failed: ${response.status} ${response.statusText}${bodyText ? ` — ${bodyText.slice(0, 300)}` : ''}`)
  }

  const envelope = (await response.json()) as StorefrontGraphqlEnvelope<T>
  if (envelope.errors && envelope.errors.length > 0) {
    return err(`Shopify Storefront API returned errors: ${envelope.errors.map((e) => e.message).join('; ')}`)
  }
  if (!envelope.data) return err('Shopify Storefront API returned no data.')
  return ok(envelope.data)
}

/** Same request path, but never cached — used only for cart mutations, where a stale response would show the wrong basket. */
async function storefrontGraphqlUncached<T>(query: string, variables?: Record<string, unknown>): Promise<Result<T, string>> {
  const creds = credentials()
  if (!creds) return err('Shopify Storefront API is not configured — SHOPIFY_STORE_DOMAIN, SHOPIFY_STOREFRONT_ACCESS_TOKEN and SHOPIFY_API_VERSION must all be set.')

  let response: Response
  try {
    response = await fetch(`https://${creds.storeDomain}/api/${creds.apiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Storefront-Access-Token': creds.accessToken,
      },
      body: JSON.stringify({ query, variables }),
      cache: 'no-store',
    })
  } catch (error) {
    return err(`Shopify Storefront API request threw: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    return err(`Shopify Storefront API request failed: ${response.status} ${response.statusText}${bodyText ? ` — ${bodyText.slice(0, 300)}` : ''}`)
  }

  const envelope = (await response.json()) as StorefrontGraphqlEnvelope<T>
  if (envelope.errors && envelope.errors.length > 0) {
    return err(`Shopify Storefront API returned errors: ${envelope.errors.map((e) => e.message).join('; ')}`)
  }
  if (!envelope.data) return err('Shopify Storefront API returned no data.')
  return ok(envelope.data)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StorefrontMoney {
  amount: string
  currencyCode: string
}

export interface StorefrontImage {
  url: string
  altText: string | null
  width: number | null
  height: number | null
}

export interface StorefrontVariant {
  id: string
  title: string
  availableForSale: boolean
  quantityAvailable: number | null
  price: StorefrontMoney
  compareAtPrice: StorefrontMoney | null
  selectedOptions: readonly { name: string; value: string }[]
  image: StorefrontImage | null
}

export interface StorefrontProduct {
  id: string
  handle: string
  title: string
  description: string
  descriptionHtml: string
  featuredImage: StorefrontImage | null
  images: readonly StorefrontImage[]
  priceRange: { min: StorefrontMoney; max: StorefrontMoney }
  compareAtPriceRange: { min: StorefrontMoney; max: StorefrontMoney } | null
  options: readonly { name: string; values: readonly string[] }[]
  variants: readonly StorefrontVariant[]
  tags: readonly string[]
  availableForSale: boolean
}

export interface StorefrontProductSummary {
  id: string
  handle: string
  title: string
  featuredImage: StorefrontImage | null
  priceRange: { min: StorefrontMoney; max: StorefrontMoney }
  compareAtPriceRange: { min: StorefrontMoney; max: StorefrontMoney } | null
  availableForSale: boolean
}

export interface StorefrontCollection {
  id: string
  handle: string
  title: string
  description: string
  image: StorefrontImage | null
}

export interface StorefrontCartLine {
  id: string
  quantity: number
  merchandise: { id: string; title: string; product: { title: string; handle: string }; image: StorefrontImage | null; price: StorefrontMoney }
}

export interface StorefrontCart {
  id: string
  checkoutUrl: string
  totalQuantity: number
  cost: { subtotalAmount: StorefrontMoney; totalAmount: StorefrontMoney }
  lines: readonly StorefrontCartLine[]
}

// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------

const MONEY_FRAGMENT = `amount currencyCode`
const IMAGE_FRAGMENT = `url altText width height`

const PRODUCT_SUMMARY_FRAGMENT = `
  id
  handle
  title
  availableForSale
  featuredImage { ${IMAGE_FRAGMENT} }
  priceRange { minVariantPrice { ${MONEY_FRAGMENT} } maxVariantPrice { ${MONEY_FRAGMENT} } }
  compareAtPriceRange { minVariantPrice { ${MONEY_FRAGMENT} } maxVariantPrice { ${MONEY_FRAGMENT} } }
`

const PRODUCT_FULL_FRAGMENT = `
  id
  handle
  title
  description
  descriptionHtml
  availableForSale
  tags
  featuredImage { ${IMAGE_FRAGMENT} }
  images(first: 10) { edges { node { ${IMAGE_FRAGMENT} } } }
  priceRange { minVariantPrice { ${MONEY_FRAGMENT} } maxVariantPrice { ${MONEY_FRAGMENT} } }
  compareAtPriceRange { minVariantPrice { ${MONEY_FRAGMENT} } maxVariantPrice { ${MONEY_FRAGMENT} } }
  options { name values }
  variants(first: 100) {
    edges {
      node {
        id
        title
        availableForSale
        quantityAvailable
        price { ${MONEY_FRAGMENT} }
        compareAtPrice { ${MONEY_FRAGMENT} }
        selectedOptions { name value }
        image { ${IMAGE_FRAGMENT} }
      }
    }
  }
`

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapImage(node: { url: string; altText: string | null; width: number | null; height: number | null } | null): StorefrontImage | null {
  if (!node) return null
  return { url: node.url, altText: node.altText, width: node.width, height: node.height }
}

interface RawProductSummary {
  id: string
  handle: string
  title: string
  availableForSale: boolean
  featuredImage: { url: string; altText: string | null; width: number | null; height: number | null } | null
  priceRange: { minVariantPrice: StorefrontMoney; maxVariantPrice: StorefrontMoney }
  compareAtPriceRange: { minVariantPrice: StorefrontMoney; maxVariantPrice: StorefrontMoney } | null
}

function mapProductSummary(node: RawProductSummary): StorefrontProductSummary {
  const compareMax = node.compareAtPriceRange?.maxVariantPrice
  const hasRealCompareAt = compareMax && Number(compareMax.amount) > Number(node.priceRange.maxVariantPrice.amount)
  return {
    id: node.id,
    handle: node.handle,
    title: node.title,
    featuredImage: mapImage(node.featuredImage),
    priceRange: { min: node.priceRange.minVariantPrice, max: node.priceRange.maxVariantPrice },
    compareAtPriceRange: hasRealCompareAt && node.compareAtPriceRange
      ? { min: node.compareAtPriceRange.minVariantPrice, max: node.compareAtPriceRange.maxVariantPrice }
      : null,
    availableForSale: node.availableForSale,
  }
}

interface RawProductFull extends RawProductSummary {
  description: string
  descriptionHtml: string
  tags: readonly string[]
  images: { edges: readonly { node: { url: string; altText: string | null; width: number | null; height: number | null } }[] }
  options: readonly { name: string; values: readonly string[] }[]
  variants: {
    edges: readonly {
      node: {
        id: string
        title: string
        availableForSale: boolean
        quantityAvailable: number | null
        price: StorefrontMoney
        compareAtPrice: StorefrontMoney | null
        selectedOptions: readonly { name: string; value: string }[]
        image: { url: string; altText: string | null; width: number | null; height: number | null } | null
      }
    }[]
  }
}

function mapProductFull(node: RawProductFull): StorefrontProduct {
  const summary = mapProductSummary(node)
  return {
    ...summary,
    description: node.description,
    descriptionHtml: node.descriptionHtml,
    tags: node.tags,
    images: node.images.edges.map((e) => mapImage(e.node)).filter((i): i is StorefrontImage => i !== null),
    options: node.options,
    variants: node.variants.edges.map((e) => ({
      id: e.node.id,
      title: e.node.title,
      availableForSale: e.node.availableForSale,
      quantityAvailable: e.node.quantityAvailable,
      price: e.node.price,
      compareAtPrice: e.node.compareAtPrice,
      selectedOptions: e.node.selectedOptions,
      image: mapImage(e.node.image),
    })),
  }
}

// ---------------------------------------------------------------------------
// Catalogue reads
// ---------------------------------------------------------------------------

export async function getFeaturedProducts(limit = 8): Promise<Result<readonly StorefrontProductSummary[], string>> {
  const query = `
    query FeaturedProducts($first: Int!) {
      products(first: $first, sortKey: BEST_SELLING) {
        edges { node { ${PRODUCT_SUMMARY_FRAGMENT} } }
      }
    }
  `
  const result = await storefrontGraphql<{ products: { edges: readonly { node: RawProductSummary }[] } }>(query, { first: limit })
  if (!result.ok) return result
  return ok(result.value.products.edges.map((e) => mapProductSummary(e.node)))
}

export async function getProductByHandle(handle: string): Promise<Result<StorefrontProduct | null, string>> {
  const query = `
    query ProductByHandle($handle: String!) {
      product(handle: $handle) { ${PRODUCT_FULL_FRAGMENT} }
    }
  `
  const result = await storefrontGraphql<{ product: RawProductFull | null }>(query, { handle })
  if (!result.ok) return result
  if (!result.value.product) return ok(null)
  return ok(mapProductFull(result.value.product))
}

export type CollectionSort = 'BEST_SELLING' | 'PRICE' | 'TITLE' | 'CREATED'

export async function getCollectionByHandle(
  handle: string,
  options: { first?: number; after?: string | null; sortKey?: CollectionSort; reverse?: boolean } = {},
): Promise<Result<{ collection: StorefrontCollection; products: readonly StorefrontProductSummary[]; hasNextPage: boolean; endCursor: string | null } | null, string>> {
  const query = `
    query CollectionByHandle($handle: String!, $first: Int!, $after: String, $sortKey: ProductCollectionSortKeys!, $reverse: Boolean!) {
      collection(handle: $handle) {
        id
        handle
        title
        description
        image { ${IMAGE_FRAGMENT} }
        products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse) {
          edges { cursor node { ${PRODUCT_SUMMARY_FRAGMENT} } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `
  const result = await storefrontGraphql<{
    collection: {
      id: string
      handle: string
      title: string
      description: string
      image: { url: string; altText: string | null; width: number | null; height: number | null } | null
      products: { edges: readonly { node: RawProductSummary }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
    } | null
  }>(query, { handle, first: options.first ?? 24, after: options.after ?? null, sortKey: options.sortKey ?? 'BEST_SELLING', reverse: options.reverse ?? false })
  if (!result.ok) return result
  if (!result.value.collection) return ok(null)
  const c = result.value.collection
  return ok({
    collection: { id: c.id, handle: c.handle, title: c.title, description: c.description, image: mapImage(c.image) },
    products: c.products.edges.map((e) => mapProductSummary(e.node)),
    hasNextPage: c.products.pageInfo.hasNextPage,
    endCursor: c.products.pageInfo.endCursor,
  })
}

export async function getAllCollections(limit = 20): Promise<Result<readonly StorefrontCollection[], string>> {
  const query = `
    query AllCollections($first: Int!) {
      collections(first: $first) {
        edges { node { id handle title description image { ${IMAGE_FRAGMENT} } } }
      }
    }
  `
  const result = await storefrontGraphql<{ collections: { edges: readonly { node: { id: string; handle: string; title: string; description: string; image: { url: string; altText: string | null; width: number | null; height: number | null } | null } }[] } }>(query, { first: limit })
  if (!result.ok) return result
  return ok(result.value.collections.edges.map((e) => ({ id: e.node.id, handle: e.node.handle, title: e.node.title, description: e.node.description, image: mapImage(e.node.image) })))
}

// ---------------------------------------------------------------------------
// Cart (Storefront API Cart — checkout itself always happens on
// Shopify's own hosted checkout via `cart.checkoutUrl`; nothing in this
// codebase collects or processes payment details)
// ---------------------------------------------------------------------------

const CART_FRAGMENT = `
  id
  checkoutUrl
  totalQuantity
  cost { subtotalAmount { ${MONEY_FRAGMENT} } totalAmount { ${MONEY_FRAGMENT} } }
  lines(first: 100) {
    edges {
      node {
        id
        quantity
        merchandise {
          ... on ProductVariant {
            id
            title
            price { ${MONEY_FRAGMENT} }
            image { ${IMAGE_FRAGMENT} }
            product { title handle }
          }
        }
      }
    }
  }
`

interface RawCart {
  id: string
  checkoutUrl: string
  totalQuantity: number
  cost: { subtotalAmount: StorefrontMoney; totalAmount: StorefrontMoney }
  lines: {
    edges: readonly {
      node: {
        id: string
        quantity: number
        merchandise: {
          id: string
          title: string
          price: StorefrontMoney
          image: { url: string; altText: string | null; width: number | null; height: number | null } | null
          product: { title: string; handle: string }
        }
      }
    }[]
  }
}

function mapCart(raw: RawCart): StorefrontCart {
  return {
    id: raw.id,
    checkoutUrl: raw.checkoutUrl,
    totalQuantity: raw.totalQuantity,
    cost: raw.cost,
    lines: raw.lines.edges.map((e) => ({
      id: e.node.id,
      quantity: e.node.quantity,
      merchandise: {
        id: e.node.merchandise.id,
        title: e.node.merchandise.title,
        product: e.node.merchandise.product,
        image: mapImage(e.node.merchandise.image),
        price: e.node.merchandise.price,
      },
    })),
  }
}

export async function createCart(lines: readonly { merchandiseId: string; quantity: number }[]): Promise<Result<StorefrontCart, string>> {
  const mutation = `
    mutation CartCreate($lines: [CartLineInput!]!) {
      cartCreate(input: { lines: $lines }) {
        cart { ${CART_FRAGMENT} }
        userErrors { field message }
      }
    }
  `
  const result = await storefrontGraphqlUncached<{ cartCreate: { cart: RawCart | null; userErrors: readonly { field: readonly string[]; message: string }[] } }>(mutation, { lines })
  if (!result.ok) return result
  const { cart, userErrors } = result.value.cartCreate
  if (userErrors.length > 0) return err(`Shopify cart create rejected: ${userErrors.map((e) => e.message).join('; ')}`)
  if (!cart) return err('Shopify cart create returned no cart.')
  return ok(mapCart(cart))
}

export async function getCart(cartId: string): Promise<Result<StorefrontCart | null, string>> {
  const query = `
    query GetCart($id: ID!) {
      cart(id: $id) { ${CART_FRAGMENT} }
    }
  `
  const result = await storefrontGraphqlUncached<{ cart: RawCart | null }>(query, { id: cartId })
  if (!result.ok) return result
  if (!result.value.cart) return ok(null)
  return ok(mapCart(result.value.cart))
}

export async function addCartLines(cartId: string, lines: readonly { merchandiseId: string; quantity: number }[]): Promise<Result<StorefrontCart, string>> {
  const mutation = `
    mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
      cartLinesAdd(cartId: $cartId, lines: $lines) {
        cart { ${CART_FRAGMENT} }
        userErrors { field message }
      }
    }
  `
  const result = await storefrontGraphqlUncached<{ cartLinesAdd: { cart: RawCart | null; userErrors: readonly { field: readonly string[]; message: string }[] } }>(mutation, { cartId, lines })
  if (!result.ok) return result
  const { cart, userErrors } = result.value.cartLinesAdd
  if (userErrors.length > 0) return err(`Shopify cart update rejected: ${userErrors.map((e) => e.message).join('; ')}`)
  if (!cart) return err('Shopify cart update returned no cart.')
  return ok(mapCart(cart))
}

export async function updateCartLineQuantity(cartId: string, lineId: string, quantity: number): Promise<Result<StorefrontCart, string>> {
  const mutation = `
    mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
      cartLinesUpdate(cartId: $cartId, lines: $lines) {
        cart { ${CART_FRAGMENT} }
        userErrors { field message }
      }
    }
  `
  const result = await storefrontGraphqlUncached<{ cartLinesUpdate: { cart: RawCart | null; userErrors: readonly { field: readonly string[]; message: string }[] } }>(mutation, {
    cartId,
    lines: [{ id: lineId, quantity }],
  })
  if (!result.ok) return result
  const { cart, userErrors } = result.value.cartLinesUpdate
  if (userErrors.length > 0) return err(`Shopify cart update rejected: ${userErrors.map((e) => e.message).join('; ')}`)
  if (!cart) return err('Shopify cart update returned no cart.')
  return ok(mapCart(cart))
}

export async function removeCartLines(cartId: string, lineIds: readonly string[]): Promise<Result<StorefrontCart, string>> {
  const mutation = `
    mutation CartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
      cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
        cart { ${CART_FRAGMENT} }
        userErrors { field message }
      }
    }
  `
  const result = await storefrontGraphqlUncached<{ cartLinesRemove: { cart: RawCart | null; userErrors: readonly { field: readonly string[]; message: string }[] } }>(mutation, { cartId, lineIds })
  if (!result.ok) return result
  const { cart, userErrors } = result.value.cartLinesRemove
  if (userErrors.length > 0) return err(`Shopify cart update rejected: ${userErrors.map((e) => e.message).join('; ')}`)
  if (!cart) return err('Shopify cart update returned no cart.')
  return ok(mapCart(cart))
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

export function formatStorefrontMoney(money: StorefrontMoney, locale = 'en-GB'): string {
  const amount = Number(money.amount)
  return new Intl.NumberFormat(locale, { style: 'currency', currency: money.currencyCode }).format(amount)
}

export const __internal = { normalizeStoreDomain, credentials }
