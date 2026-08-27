/**
 * Outside `actions.ts` because a `'use server'` module may only export async
 * functions — mirrors `products/state.ts`'s `DecisionChangeState` exactly.
 */
export interface PurchaseQueueActionState {
  status: 'idle' | 'success' | 'error'
  message: string
}

export const initialPurchaseQueueActionState: PurchaseQueueActionState = { status: 'idle', message: '' }
