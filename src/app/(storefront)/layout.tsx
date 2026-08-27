import { Fraunces, Inter } from 'next/font/google'
import './storefront.css'
import { Header } from './_components/Header'
import { Footer } from './_components/Footer'

const displayFont = Fraunces({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-store-display' })
const bodyFont = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-store-body' })

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`storefront ${displayFont.variable} ${bodyFont.variable}`}>
      <Header />
      <main>{children}</main>
      <Footer />
    </div>
  )
}
