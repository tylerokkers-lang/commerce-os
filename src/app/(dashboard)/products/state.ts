/**
 * Outside `actions.ts` because a `'use server'` module may only export async
 * functions — mirrors `opportunities/state.ts`'s `StageChangeState` exactly.
 */
export interface DecisionChangeState {
  status: 'idle' | 'changed' | 'error'
  message: string
}

export const initialDecisionChangeState: DecisionChangeState = { status: 'idle', message: '' }
