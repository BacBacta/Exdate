import type { Metadata } from 'next'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import { Motion } from './components/Motion'
import './globals.css'

export const metadata: Metadata = {
  title: 'exdate — see what your tokenized stock actually paid you',
  description:
    'When a tokenized stock pays a dividend, nothing lands in your wallet: the token becomes worth a little more. exdate measures how much, and how much went missing on the way.',
  // Every og:image and twitter:image is made absolute against this. It said
  // `exdate.xyz`, which belongs to an unrelated site, so every share of a page
  // here pointed its preview image at a stranger's server. Derived instead:
  // NEXT_PUBLIC_EXDATE_SITE_URL once a domain exists, else the production URL
  // Vercel sets on every build - which already follows a custom domain when one
  // is attached - and the current alias as the last resort.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_EXDATE_SITE_URL ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'https://exdate-bactas-projects.vercel.app'),
  ),
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
