/**
 * Order validation (Milestone 5).
 *
 * The check between "a marketplace sent us something" and "this is a record
 * we are willing to act on." A marketplace order snapshot is external input —
 * the same discipline applies as to any other boundary in this system: it is
 * checked, not trusted, before anything downstream (stock reservation,
 * fulfilment, invoicing) is allowed to depend on it.
 */

export interface OrderValidationInput {
  externalId: string
  totalMinor: number
  currency: string
  lineItemCount: number
  /** True when every line item's SKU was resolved against our own catalogue. */
  allLineItemsResolved: boolean
  /** Sum of the resolved line items' own totals, for a cross-check against totalMinor. */
  lineItemsTotalMinor: number | null
}

export interface ValidationIssue {
  field: string
  message: string
  /** A structural problem the order cannot proceed with; a mismatch worth a human's attention but not fatal. */
  severity: 'fatal' | 'warning'
}

export interface ValidationResult {
  valid: boolean
  issues: readonly ValidationIssue[]
}

/**
 * The tolerance for a totals mismatch between what the marketplace reports as
 * the order total and the sum of the line items we could resolve. A few pence
 * of rounding across several line items is normal; anything larger suggests a
 * missing discount, an unresolved line item, or a genuine data problem worth
 * a person looking at.
 */
const TOTAL_MISMATCH_TOLERANCE_MINOR = 5

export function validateOrder(input: OrderValidationInput): ValidationResult {
  const issues: ValidationIssue[] = []

  if (!input.externalId || input.externalId.trim().length === 0) {
    issues.push({ field: 'externalId', message: 'No external order id was provided.', severity: 'fatal' })
  }
  if (input.totalMinor < 0) {
    issues.push({ field: 'totalMinor', message: `Order total is negative (${input.totalMinor}).`, severity: 'fatal' })
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    issues.push({ field: 'currency', message: `"${input.currency}" is not a recognisable three-letter currency code.`, severity: 'fatal' })
  }
  if (input.lineItemCount === 0) {
    issues.push({ field: 'lineItemCount', message: 'Order has no line items.', severity: 'fatal' })
  }
  if (!input.allLineItemsResolved) {
    issues.push({
      field: 'lineItems',
      message: 'One or more line items could not be matched to a product in our catalogue by SKU.',
      severity: 'fatal',
    })
  }

  if (input.lineItemsTotalMinor !== null) {
    const mismatch = Math.abs(input.totalMinor - input.lineItemsTotalMinor)
    if (mismatch > TOTAL_MISMATCH_TOLERANCE_MINOR) {
      issues.push({
        field: 'totalMinor',
        message: `Order total (${input.totalMinor}) differs from the sum of resolved line items (${input.lineItemsTotalMinor}) by ${mismatch}, beyond the ${TOTAL_MISMATCH_TOLERANCE_MINOR}-minor-unit tolerance.`,
        severity: 'warning',
      })
    }
  }

  const fatal = issues.filter((i) => i.severity === 'fatal')
  return { valid: fatal.length === 0, issues }
}
