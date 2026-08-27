'use client'

import { useActionState } from 'react'
import { addToCart, initialCartActionState } from '../actions'

export function AddToCartButton({ variantId, available }: { variantId: string | null; available: boolean }) {
  const [state, formAction, pending] = useActionState(addToCart, initialCartActionState)

  const disabled = !variantId || !available || pending

  return (
    <form action={formAction} className="mt-2">
      <input type="hidden" name="variantId" value={variantId ?? ''} />
      <input type="hidden" name="quantity" value={1} />
      <button
        type="submit"
        disabled={disabled}
        className="w-full rounded-full bg-[var(--store-ink)] py-3.5 text-sm font-medium text-[var(--store-ink-inverse)] transition-colors hover:bg-[var(--store-accent)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {!available ? 'Sold out' : pending ? 'Adding…' : !variantId ? 'Select an option' : 'Add to bag'}
      </button>
      {state.status === 'ok' ? <p className="mt-2 text-center text-xs text-[var(--store-success)]">{state.message}</p> : null}
      {state.status === 'error' ? <p className="mt-2 text-center text-xs text-[var(--store-sale)]">{state.message}</p> : null}
    </form>
  )
}
