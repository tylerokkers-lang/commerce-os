import type { CreateListingInput, CreateListingImage, CreateListingVariant } from '../connectors/types'

/**
 * Deterministic Shopify product payload construction (Milestone:
 * controlled Shopify publication, Phase 6).
 *
 * Pure and fully unit-testable — no network, no database, no pricing
 * logic of its own. `selectedPriceMinor` is supplied by the caller,
 * already chosen from Phase 4's `recommendedPriceMinor`/
 * `minimumViablePriceMinor` or a manually overridden figure — this file
 * never calculates a price. When a product has no real variants (the
 * common case for anything imported through Phase 5, which does not
 * currently capture variant data), a single implicit default variant is
 * built from the product's own SKU and the selected price — Shopify's
 * own "Default Title" convention for a single-option product, never a
 * fabricated option.
 */

export interface PayloadBuilderInput {
  productId: string
  idempotencyKey: string
  title: string
  descriptionHtml: string
  productType: string | null
  vendor: string | null
  tags: readonly string[]
  productSku: string
  currency: string
  selectedPriceMinor: number
  compareAtPriceMinor: number | null
  weightGrams: number | null
  images: readonly CreateListingImage[]
  variants: readonly CreateListingVariant[]
  seoTitle: string | null
  seoDescription: string | null
}

/**
 * Every payload is tagged with our own internal product id. Shopify's
 * `productCreate` has no first-class idempotency-key parameter, so this
 * tag is the mitigation for the residual "request timed out after
 * Shopify processed it but before our response arrived" risk noted in
 * `publicationService.ts`: a future reconciliation pass can search for
 * this exact tag to detect whether a product already exists before
 * assuming a retry is safe. Not itself a full search-before-create
 * flow — that's future work, not built this phase.
 */
function traceabilityTag(productId: string): string {
  return `commerce-os:product-id:${productId}`
}

export function buildShopifyProductPayload(input: PayloadBuilderInput): CreateListingInput {
  const variants: readonly CreateListingVariant[] =
    input.variants.length > 0
      ? input.variants
      : [
          {
            sku: input.productSku,
            priceMinor: input.selectedPriceMinor,
            options: [],
            weightGrams: input.weightGrams,
          },
        ]

  return {
    productId: input.productId,
    idempotencyKey: input.idempotencyKey,
    title: input.title,
    descriptionHtml: input.descriptionHtml,
    productType: input.productType,
    vendor: input.vendor,
    tags: [...input.tags, traceabilityTag(input.productId)],
    currency: input.currency,
    compareAtPriceMinor: input.compareAtPriceMinor,
    images: input.images,
    variants,
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    status: 'draft',
  }
}
