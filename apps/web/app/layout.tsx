import type { Metadata } from 'next'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import { Motion } from './components/Motion'
import './globals.css'

export const metadata: Metadata = {
  title: 'exdate — see what your Stock Tokens actually paid you',
  description:
    'When a Stock Token pays a dividend, nothing lands in your wallet: the token becomes worth a little more. exdate measures how much, and how much went missing on the way.',
  // Every og:image and twitter:image is made absolute against this, so it decides
  // whose server answers when someone shares a page. It said `exdate.xyz`, which
  // belongs to an unrelated site. VERCEL_PROJECT_PRODUCTION_URL was tried next
  // and is not the right source either: measured on the live build, Vercel filled
  // it with the project's claimed *.vercel.app alias rather than the custom
  // domain. The canonical host is a fact now, so it is written down - www, since
  // the apex 308-redirects there - and an env var can still override it.
  metadataBase: new URL(process.env.NEXT_PUBLIC_EXDATE_SITE_URL || 'https://www.exdate.me'),
  openGraph: {
    title: 'exdate',
    description: 'See what your Stock Tokens actually paid you.',
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
