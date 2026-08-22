/**
 * Kept out of `actions.ts` because a `'use server'` module may only export
 * async functions.
 */
export interface LoginState {
  error: string
}

export const initialLoginState: LoginState = { error: '' }
