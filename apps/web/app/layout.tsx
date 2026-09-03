import type { Metadata } from 'next'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import './globals.css'

export const metadata: Metadata = {
  title: 'exdate — the corporate-action layer for tokenized stocks',
  description:
    'Every dividend and split on Robinhood Chain Stock Tokens, reconciled against the issuer’s own declared rate. The effective haircut, published nowhere else.',
  metadataBase: new URL('https://exdate.xyz'),
  openGraph: {
    title: 'exdate',
    description: 'The corporate-action layer for tokenized stocks. Observed, not assumed.',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
