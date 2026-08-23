/**
 * Outside `actions.ts` because a `'use server'` module may only export async
 * functions.
 */
export interface StageChangeState {
  status: 'idle' | 'changed' | 'error'
  message: string
}

export const initialStageChangeState: StageChangeState = { status: 'idle', message: '' }
