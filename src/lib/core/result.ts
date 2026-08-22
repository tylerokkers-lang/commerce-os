/**
 * A Result type for operations that can fail in ways the caller is expected to
 * handle: a compliance block, a supplier rejection, a spending limit breach.
 *
 * Exceptions stay reserved for genuine faults. Business rules that say "no" are
 * ordinary outcomes and should be impossible to ignore by accident.
 */

export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback
}

export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result
}
