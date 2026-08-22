/**
 * Form state shared between the action and the form.
 *
 * These live outside `actions.ts` because a `'use server'` module may only
 * export async functions. Exporting a plain object from one does not fail
 * loudly: it simply arrives as `undefined` on the client.
 */
export interface SettingsFormState {
  status: 'idle' | 'saved' | 'error'
  message: string
  fieldErrors: Record<string, string>
}

export const initialSettingsState: SettingsFormState = {
  status: 'idle',
  message: '',
  fieldErrors: {},
}
