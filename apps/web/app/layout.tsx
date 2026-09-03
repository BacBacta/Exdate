import type { Metadata } from 'next'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import { Motion } from './components/Motion'
import './globals.css'

export const metadata: Metadata = {
  title: 'exdate — see what your tokenized stock actually paid you',
  description:
    'When a tokenized stock pays a dividend, nothing lands in your wallet: the token becomes worth a little more. exdate measures how much, and how much went missing on the way.',
  metadataBase: new URL('https://exdate.xyz'),
  openGraph: {
    title: 'exdate',
    description: 'See what your tokenized stock actually paid you.',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        {/*
          Runs before first paint. Only under `data-js` does the stylesheet hide
          anything for the reveal animation, so a reader without JavaScript gets
          the whole page, and a reader with it never sees content flash.
        */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.setAttribute('data-js','')" }} />
      </head>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        {children}
        <Motion />
      </body>
    </html>
  )
}
