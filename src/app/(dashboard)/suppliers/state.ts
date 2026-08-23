/**
 * Form state for the supplier form.
 *
 * Outside `actions.ts` because a `'use server'` module may only export async
 * functions; a plain object exported from one arrives as `undefined`.
 */
export interface SupplierFormState {
  status: 'idle' | 'saved' | 'error'
  message: string
  fieldErrors: Record<string, string>
  savedId?: string
}

export const initialSupplierState: SupplierFormState = {
  status: 'idle',
  message: '',
  fieldErrors: {},
}
