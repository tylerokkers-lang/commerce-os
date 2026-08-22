import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Commerce OS',
  description: 'AI ecommerce operating system for Shopify and Amazon UK.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  )
}
