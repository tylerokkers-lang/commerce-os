/**
 * Outside `actions.ts` because a `'use server'` module may only export async
 * functions — mirrors `opportunities/state.ts`'s `StageChangeState` exactly.
 */
export interface DecisionChangeState {
  status: 'idle' | 'changed' | 'error'
  message: string
}

export const initialDecisionChangeState: DecisionChangeState = { status: 'idle', message: '' }

export interface IntelligenceActionState {
  status: 'idle' | 'ok' | 'error'
  message?: string
}

export const initialIntelligenceState: IntelligenceActionState = { status: 'idle' }

export interface ShippingActionState {
  status: 'idle' | 'ok' | 'error'
  message: string
}

export const initialShippingState: ShippingActionState = { status: 'idle', message: '' }

export interface MediaActionState {
  status: 'idle' | 'ok' | 'error'
  message: string
}

export const initialMediaState: MediaActionState = { status: 'idle', message: '' }

export interface PublicationActionState {
  status: 'idle' | 'ok' | 'error'
  message: string
}

export const initialPublicationState: PublicationActionState = { status: 'idle', message: '' }
