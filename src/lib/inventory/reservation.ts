import { err, ok, type Result } from '@/lib/core/result'

/**
 * Stock reservation (Milestone 5).
 *
 * "Available stock is derived, never stored" was already the rule in
 * `0004_inventory.sql`: `on_hand_qty - reserved_qty`. This is the pure
 * decision logic that sits in front of that arithmetic — whether a new
 * reservation (an order being ingested, needing stock committed to it) can be
 * satisfied right now, given what is already reserved.
 *
 * The stock race condition this exists to handle: two orders arrive for the
 * last unit of a product within the same sync window. Whichever is evaluated
 * second must be told there is nothing left, rather than both succeeding and
 * discovering the shortfall only when a supplier order is placed for -1
 * units. This function makes that check explicit and testable rather than
 * leaving it to whichever database write happens to land first.
 */

export interface StockState {
  onHandQty: number
  reservedQty: number
}

export interface ReservationRequest {
  orderId: string
  quantity: number
}

export interface ReservationOutcome {
  granted: boolean
  reason: string
  newReservedQty: number
  availableAfter: number
}

const available = (state: StockState): number => Math.max(state.onHandQty - state.reservedQty, 0)

/**
 * Decides whether a reservation can be granted against the stock state as
 * currently known. Returns a `Result` because "insufficient stock" is an
 * expected business outcome (triggering a backorder or a supplier switch),
 * not a fault.
 */
export function reserveStock(
  state: StockState,
  request: ReservationRequest,
): Result<ReservationOutcome, string> {
  if (request.quantity <= 0) {
    return err(`Reservation quantity must be positive, got ${request.quantity}.`)
  }

  const currentlyAvailable = available(state)
  if (request.quantity > currentlyAvailable) {
    return err(
      `Order ${request.orderId} requests ${request.quantity} units but only ${currentlyAvailable} are available (${state.onHandQty} on hand, ${state.reservedQty} already reserved).`,
    )
  }

  const newReservedQty = state.reservedQty + request.quantity
  return ok({
    granted: true,
    reason: `Reserved ${request.quantity} units for order ${request.orderId}.`,
    newReservedQty,
    availableAfter: state.onHandQty - newReservedQty,
  })
}

/**
 * Releases a reservation — an order being cancelled before it shipped, most
 * commonly. Clamped at zero so a double-release (the exact duplicate-webhook
 * shape this system defends against elsewhere) cannot drive reserved stock
 * negative.
 */
export function releaseReservation(state: StockState, quantity: number): StockState {
  return { ...state, reservedQty: Math.max(state.reservedQty - quantity, 0) }
}

/**
 * Resolves a batch of reservation requests against one stock state in order,
 * so the race condition is decided deterministically rather than by whichever
 * request happens to reach the database first. Requests are processed in the
 * order given — callers should sort by order placement time so the customer
 * who ordered first is served first.
 */
export function reserveStockBatch(
  initialState: StockState,
  requests: readonly ReservationRequest[],
): { granted: readonly ReservationOutcome[]; denied: readonly { request: ReservationRequest; reason: string }[] } {
  let state = initialState
  const granted: ReservationOutcome[] = []
  const denied: { request: ReservationRequest; reason: string }[] = []

  for (const request of requests) {
    const result = reserveStock(state, request)
    if (result.ok) {
      granted.push(result.value)
      state = { ...state, reservedQty: result.value.newReservedQty }
    } else {
      denied.push({ request, reason: result.error })
    }
  }

  return { granted, denied }
}
