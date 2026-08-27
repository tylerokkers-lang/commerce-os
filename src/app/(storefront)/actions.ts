'use server'

import { revalidatePath } from 'next/cache'
import { createCart, addCartLines, updateCartLineQuantity, removeCartLines } from '@/lib/shopify/storefront'
import { getOrCreateCartId, setCartCookie } from './cart'

export interface CartActionState {
  status: 'idle' | 'ok' | 'error'
  message?: string
}

export const initialCartActionState: CartActionState = { status: 'idle' }

export async function addToCart(_prev: CartActionState, formData: FormData): Promise<CartActionState> {
  const variantId = formData.get('variantId')
  const quantityRaw = formData.get('quantity')
  if (typeof variantId !== 'string' || !variantId) return { status: 'error', message: 'Choose a variant first.' }
  const quantity = Math.max(1, Number(quantityRaw) || 1)

  const existingCartId = await getOrCreateCartId()

  const result = existingCartId
    ? await addCartLines(existingCartId, [{ merchandiseId: variantId, quantity }])
    : await createCart([{ merchandiseId: variantId, quantity }])

  if (!result.ok) return { status: 'error', message: result.error }

  await setCartCookie(result.value.id)
  revalidatePath('/shop/cart')
  return { status: 'ok', message: 'Added to bag.' }
}

export async function updateCartLine(cartId: string, lineId: string, quantity: number): Promise<CartActionState> {
  const result = quantity <= 0
    ? await removeCartLines(cartId, [lineId])
    : await updateCartLineQuantity(cartId, lineId, quantity)
  if (!result.ok) return { status: 'error', message: result.error }
  revalidatePath('/shop/cart')
  return { status: 'ok' }
}

export async function removeCartLine(cartId: string, lineId: string): Promise<CartActionState> {
  const result = await removeCartLines(cartId, [lineId])
  if (!result.ok) return { status: 'error', message: result.error }
  revalidatePath('/shop/cart')
  return { status: 'ok' }
}
