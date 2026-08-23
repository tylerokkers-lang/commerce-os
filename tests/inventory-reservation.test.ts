import { describe, expect, it } from 'vitest'
import { releaseReservation, reserveStock, reserveStockBatch } from '@/lib/inventory/reservation'

describe('stock reservation', () => {
  it('grants a reservation within available stock', () => {
    const result = reserveStock({ onHandQty: 10, reservedQty: 2 }, { orderId: 'ord-1', quantity: 5 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.newReservedQty).toBe(7)
      expect(result.value.availableAfter).toBe(3)
    }
  })

  it('refuses a reservation exceeding available stock', () => {
    const result = reserveStock({ onHandQty: 10, reservedQty: 8 }, { orderId: 'ord-1', quantity: 5 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/only 2 are available/)
  })

  it('refuses a non-positive quantity', () => {
    expect(reserveStock({ onHandQty: 10, reservedQty: 0 }, { orderId: 'ord-1', quantity: 0 }).ok).toBe(false)
    expect(reserveStock({ onHandQty: 10, reservedQty: 0 }, { orderId: 'ord-1', quantity: -1 }).ok).toBe(false)
  })

  it('the stock race condition: the second of two orders for the last unit is refused', () => {
    // The brief's exact scenario: two orders arrive for the last unit within
    // the same sync window.
    const initial = { onHandQty: 5, reservedQty: 4 } // only 1 unit available
    const first = reserveStock(initial, { orderId: 'ord-first', quantity: 1 })
    expect(first.ok).toBe(true)

    const stateAfterFirst = first.ok ? { onHandQty: initial.onHandQty, reservedQty: first.value.newReservedQty } : initial
    const second = reserveStock(stateAfterFirst, { orderId: 'ord-second', quantity: 1 })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toMatch(/ord-second/)
  })

  it('releases a reservation, freeing stock for the next order', () => {
    const released = releaseReservation({ onHandQty: 10, reservedQty: 5 }, 3)
    expect(released.reservedQty).toBe(2)
  })

  it('clamps a release at zero rather than going negative on a double release', () => {
    // Guards the same duplicate-event shape as the webhook idempotency logic:
    // releasing the same reservation twice must not corrupt the stock state.
    const onceReleased = releaseReservation({ onHandQty: 10, reservedQty: 2 }, 5)
    expect(onceReleased.reservedQty).toBe(0)
    const twiceReleased = releaseReservation(onceReleased, 5)
    expect(twiceReleased.reservedQty).toBe(0)
  })
})

describe('batch reservation, resolved deterministically', () => {
  it('grants requests in order until stock runs out, denying the rest', () => {
    const { granted, denied } = reserveStockBatch(
      { onHandQty: 5, reservedQty: 0 },
      [
        { orderId: 'ord-1', quantity: 2 },
        { orderId: 'ord-2', quantity: 2 },
        { orderId: 'ord-3', quantity: 2 }, // only 1 left when this is evaluated
      ],
    )
    expect(granted).toHaveLength(2)
    expect(denied).toHaveLength(1)
    expect(denied[0].request.orderId).toBe('ord-3')
  })

  it('the customer who ordered first is served first when order matters', () => {
    const { granted } = reserveStockBatch(
      { onHandQty: 3, reservedQty: 0 },
      [
        { orderId: 'ord-earliest', quantity: 3 },
        { orderId: 'ord-latest', quantity: 1 },
      ],
    )
    expect(granted).toHaveLength(1)
    expect(granted[0].reason).toMatch(/ord-earliest/)
  })
})
