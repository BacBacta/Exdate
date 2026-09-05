import type { Metadata } from 'next'
import { Footer, Nav } from '../components/Chrome'
import { Chip, Links, Section, Stats, Table } from '../components/Ui'
import { dateLong } from '../../lib/format'
import { observed, timing } from '../../lib/observed'

/**
 * How a dividend reaches a token, where exdate looks, what it refuses, who
 * makes it and how to reach them. One page where there were two.
 */
export const metadata: Metadata = {
  title: 'About — exdate',
  description: 'How a dividend reaches a Stock Token, how exdate measures it, where it looks, what it refuses to do, who makes it.',
}

const { links, counts, chains, lastObservedAt } = observed
const owner = links.github ? (new URL(links.github).pathname.split('/').filter(Boolean)[0] ?? null) : null
const contact = process.env.NEXT_PUBLIC_EXDATE_CONTACT ?? null

export default function Page() {
  return (
    <>
      <Nav />
      <main id="main">
        <section className="hero token-hero" aria-labelledby="about-title">
          <div className="wrap">
            <p className="token-kind">About</p>
            <h1 id="about-title">An independent measurement.</h1>
            <p className="lede">
              exdate reads Robinhood Chain and the issuer&rsquo;s own feed and states what each Stock Token&rsquo;s dividends actually delivered. Not affiliated with, endorsed by, or connected with Robinhood Markets, Inc., Coinbase or Chainlink.
            </p>
          </div>
        </section>

        <Section id="method" title="How a dividend reaches a token" tight>
          <ol className="steps">
            <li>
              <span className="step-n">01</span>
              <h3>Declared</h3>
              <p>The issuer states what each share pays, and on which day.</p>
            </li>
            <li>
              <span className="step-n">02</span>
              <h3>The token adjusts</h3>
              <p>No cash lands. The multiplier rises: your balance is unchanged, what it represents grows.</p>
            </li>
            <li>
              <span className="step-n">03</span>
              <h3>Measured</h3>
              <p>Declared against what arrived, priced at the instant of the step.</p>
            </li>
          </ol>
          <Stats
            items={[
              { value: `~${timing.medianLeadMinutes} min`, label: 'warning before a change', note: `${timing.changes} changes so far` },
              { value: '1 day', label: 'after the issuer’s date', note: `${timing.lagOneDay} of ${timing.lagCases} datable cases` },
              { value: counts.tokens, label: 'Stock Tokens read', note: `last observed ${dateLong(lastObservedAt)}` },
            ]}
          />
        </Section>

        <Section id="coverage" title="Where it looks" tight>
          <Table
            caption="Chains and issuers exdate reads"
            cols={[
              { key: 'chain', label: 'Chain', primary: true },
              { key: 'tokens', label: 'Tokens', align: 'right', numeric: true },
              { key: 'feeds', label: 'Price feeds', align: 'right', numeric: true },
              { key: 'state', label: 'State', align: 'right' },
            ]}
            rows={[
              { key: 'rh', cells: { chain: <><span className="name">{chains.robinhood.name}</span><span className="sub">{chains.robinhood.issuer}</span></>, tokens: chains.robinhood.tokens, feeds: chains.robinhood.feeds, state: <Chip tone="on">measured live</Chip> } },
              { key: 'base', cells: { chain: <><span className="name">{chains.base.name}</span><span className="sub">{chains.base.issuer}</span></>, tokens: chains.base.tokens, feeds: chains.base.feeds, state: <Chip tone="off">verified, nothing moved yet</Chip> } },
            ]}
          />
        </Section>

        <Section id="rules" title="What it refuses to do" tight>
          <ul className="rules">
            <li>Invent a number. No data, the page says so: a token without a feed gets no gap, a dividend not landed gets no landing date.</li>
            <li>Estimate. Nothing is annualised, modelled or projected; every API answer lists what it refused and why.</li>
            <li>Multiply a Chainlink price by the multiplier: the feeds already include it.</li>
            <li>Identify a token by its ticker. Always by address.</li>
          </ul>
        </Section>

        <Section id="who" title="Who" tight>
          <p className="sec-line">
            {owner ? (
              <>
                Made by <a href={links.github!}>{owner}</a>, in the open: code, data and every decision with the measurement behind it are in the repository.
              </>
            ) : (
              <>Made in the open: code, data and every decision with the measurement behind it are published.</>
            )}{' '}
            Observations are <a href={links.data}>CC BY 4.0</a>; code is MIT; the issuer&rsquo;s own files are not redistributed. Stock Tokens are debt securities issued by Robinhood Assets (Jersey) Limited, not the share; nothing here is investment advice.
          </p>
          <Links>
            {contact ? <a href={`mailto:${contact}`}>{contact}</a> : null}
            {links.github ? <a href={`${links.github}/issues`}>Report a wrong figure</a> : null}
            <a href="/docs/changelog/">Changelog</a>
            <a href="/data/">The data</a>
          </Links>
        </Section>
      </main>
      <Footer />
    </>
  )
}
