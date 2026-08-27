/**
 * The one place the storefront's brand name lives. No brand identity exists
 * anywhere in this project yet (confirmed by inspection — "Commerce OS" is
 * the internal admin tool's name, never customer-facing), so this is a
 * deliberately plain, obviously-a-placeholder default rather than an
 * invented brand — set NEXT_PUBLIC_STORE_NAME to replace it.
 */
export const STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME?.trim() || 'Your Store'
