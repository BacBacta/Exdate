import type { Metadata } from 'next'
import { Footer, Nav } from '../components/Chrome'
import { dateLong, delay } from '../../lib/format'
import { observed } from '../../lib/observed'

/**
 * Who is behind this, what it is, what it is not, and how to reach it. The
 * site had no such page and no contact (audit 2026-09-05, F26), and the
 * first thing a reader checks before trusting a number is whether anyone
 * stands behind it. Nothing here is asserted that the repository does not
 * show: the maker is named from the repository's owner, and a contact
 * address renders only when one is configured.
 */
export const metadata: Metadata = {
  title: 'About — exdate',
  description: 'What exdate is, what it is not, who makes it, and how to reach them.',
}

const { links, counts, lastObservedAt } = observed
const owner = links.github ? new URL(links.github).pathname.split('/').filter(Boolean)[0] ?? null : null
/** Set NEXT_PUBLIC_EXDATE_CONTACT to an address to publish it; nothing is invented in its place. */
const contact = process.env.NEXT_PUBLIC_EXDATE_CONTACT ?? null

export default function Page() {
  return (
    <>
      <Nav />
      <main id="main">
        <section className="hero token-hero" aria-labelledby="about-title">
          <div className="wrap">
            <div data-reveal>
              <p className="token-kind">About</p>
              <h1 id="about-title">An independent measurement.</h1>
            </div>
            <p className="lede" data-reveal style={delay(120)}>
              exdate reads Robinhood Chain and the issuer&rsquo;s own feed, and states what each Stock
              Token&rsquo;s dividends actually delivered. It is not affiliated with, endorsed by, or
              officially connected with Robinhood Markets, Inc., Coinbase, or Chainlink.
            </p>
          </div>
        </section>

        <section className="block tight" aria-label="What it is">
          <div className="wrap">
            <div className="prose-tight">
            <h2 className="small" data-reveal>
              What it is
            </h2>
            <p data-reveal>
              A data layer for Stock Tokens: an indexer, an API, signed webhooks, a token list and this
              site, all reading the same committed record. Every figure on every page is read at build
              time from a file in the repository, dated, and traceable to a log on chain or a row in the
              issuer&rsquo;s feed. Today it reads {counts.tokens} Robinhood Stock Tokens and{' '}
              {counts.feeds} Chainlink feeds, and was last observed on {dateLong(lastObservedAt)}.
            </p>

            <h2 className="small" data-reveal>
              What it refuses to do
            </h2>
            <p data-reveal>
              Invent a number. Where there is no data the page says so; a token without a price feed
              gets no gap, a dividend that has not landed gets no landing date, and nothing is
              annualised, modelled or estimated. Every API answer lists what it refused to compute
              and why. Chainlink&rsquo;s prices for these tokens already include the multiplier and are
              never multiplied by it again. Tokens are identified by address, never by ticker.
            </p>

            <h2 className="small" data-reveal>
              What it is not
            </h2>
            <p data-reveal>
              Not investment advice, and not a statement about any issuer&rsquo;s intent. Stock Tokens
              are debt securities issued by Robinhood Assets (Jersey) Limited that track a share; they
              are not the share. The gaps measured here are observations of what reached the chain,
              and the reasons behind them are not observable from the chain.
            </p>

            <h2 className="small" data-reveal>
              Who
            </h2>
            <p data-reveal>
              {owner ? (
                <>
                  Made by <a href={links.github!}>{owner}</a>, in the open: the code, the data and every
                  decision with the measurement behind it are in the repository.
                </>
              ) : (
                <>Made in the open: the code, the data and every decision with the measurement behind it are published.</>
              )}{' '}
              The observations are <a href={links.data}>CC BY 4.0</a>; the code is MIT; the issuer&rsquo;s own
              files are reproduced under a personal, non-sublicensable licence and are not redistributed.
            </p>

            <h2 className="small" data-reveal>
              Contact
            </h2>
            <p data-reveal>
              {contact ? (
                <>
                  <a href={`mailto:${contact}`}>{contact}</a>
                  {links.github ? <>, or </> : null}
                </>
              ) : null}
              {links.github ? (
                <>
                  <a href={`${links.github}/issues`}>an issue on GitHub</a> for a bug, a wrong figure or a
                  question about a token.
                </>
              ) : null}
              {!contact && !links.github ? 'No contact is configured for this deployment.' : null} A wrong
              figure is the one thing this site must never carry; it is fixed in the data, with the
              correction on record.
            </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
