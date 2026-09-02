import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'exdate — Robinhood Chain Stock Token status',
  description:
    'Live ERC-8056 multiplier, scheduled corporate actions and Chainlink feed health for every Robinhood Chain Stock Token.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
