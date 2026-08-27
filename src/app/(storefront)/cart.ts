import 'server-only'
import { cookies } from 'next/headers'
import { getCart, type StorefrontCart } from '@/lib/shopify/storefront'

const CART_COOKIE = 'storefront_cart_id'

/**
 * The cart is identified by a single opaque id stored in a cookie —
 * Shopify's own Storefront API cart, not anything this codebase persists.
 * A stale/expired cart id (the customer's Shopify cart can itself expire)
 * is handled by treating a missing `getCart` result as "no cart yet" and
 * creating a fresh one, never as an error the shopper has to see.
 */
export async function getCurrentCart(): Promise<StorefrontCart | null> {
  const cookieStore = await cookies()
  const cartId = cookieStore.get(CART_COOKIE)?.value
  if (!cartId) return null
  const result = await getCart(cartId)
  if (!result.ok) return null
  return result.value
}

export async function getOrCreateCartId(): Promise<string | null> {
  const cookieStore = await cookies()
  const existing = cookieStore.get(CART_COOKIE)?.value
  if (existing) {
    const result = await getCart(existing)
    if (result.ok && result.value) return existing
  }
  return null
}

export async function setCartCookie(cartId: string) {
  const cookieStore = await cookies()
  cookieStore.set(CART_COOKIE, cartId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
}
