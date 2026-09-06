import type { Metadata } from 'next'
import { Footer, Nav } from '../components/Chrome'
import { Subscribe } from '../components/Subscribe'
import { Links, Method, Section } from '../components/Ui'
import { dateLong } from '../../lib/format'
import { calendar, changes, observed } from '../../lib/observed'

/**
 * The four ways to be told instead of remembering to come back, each explained in plain words.
 *
 * This page exists because the footer used to link the files themselves - /calendar.ics,
 * /feed.xml, /badge.svg, /tokenlist.json - under a heading that read like pages. A person who
 * clicked "Calendar" landed on BEGIN:VCALENDAR, and one who clicked "Token list" on 124 KB of
 * JSON. The files are right; they are for programs. What a person needs first is what each one
 * is and where to paste it, and only then the file, labelled as a file.
 */
export const metadata: Metadata = {
  title: 'Subscribe — exdate',
  description:
    'Four ways to be told when a dividend is declared or lands: a calendar to subscribe to, an RSS feed, a badge for a page of your own, and a token list a wallet can import.',
}

export default function Page() {
  const { site } = observed.links
  const icsUrl = `${site}/calendar.ics`
  const feedUrl = `${site}/feed.xml`
  const listUrl = `${site}/tokenlist.json`
  const badgeUrl = `${site}/badge.svg`
  const badgeAlt = 'exdate: what the last measured dividend delivered'
  const badgeMarkdown = `[![${badgeAlt}](${badgeUrl})](${site}/)`
  const badgeHtml = `<a href="${site}/"><img src="${badgeUrl}" alt="${badgeAlt}"></a>`
  const listed = observed.tokenList

  return (
    <>
      <Nav />
      <main id="main">
        <section className="hero token-hero" aria-labelledby="subscribe-title">
          <div className="wrap">
            <div data-reveal>
              <p className="token-kind">Be told, instead of remembering</p>
              <h1 id="subscribe-title">Subscribe</h1>
            </div>
            <p className="lede" data-reveal>
              Four ways to follow the record without coming back to check it. Each one is built
              from the same committed data as every page here, so none can carry a date or a
              figure that is not in git.
            </p>
          </div>
        </section>

        <Section
          id="calendar"
          title="In your calendar"
          line={`Every declared dividend on the day the issuer names, and every change the moment it took effect on chain — ${calendar.total} declared and ${changes.length} landed today.`}
        >
          <Subscribe icsPath="/calendar.ics" site={site} what="every declared dividend and every observed change" />
          <Method title="How to add it, app by app">
            <dl>
              <dt>Apple Calendar, Outlook, Thunderbird</dt>
              <dd>
                The button above opens the subscription directly. If nothing happens, add a
                calendar &ldquo;by URL&rdquo; and paste <code>{icsUrl}</code>.
              </dd>
              <dt>Google Calendar</dt>
              <dd>
                Google does not open <code>webcal:</code> links. In the left panel, <em>Other
                calendars</em> → <em>+</em> → <em>From URL</em>, then paste <code>{icsUrl}</code>.
                Google refreshes a subscribed calendar about once a day.
              </dd>
              <dt>One token only</dt>
              <dd>
                Every token page with something to put in a calendar offers its own, under the
                dividends table. It carries that token&rsquo;s rows and nothing else.
              </dd>
            </dl>
            <p>
              A subscription follows the record; a download is a snapshot of it today. The file
              itself: <a href="/calendar.ics">calendar.ics</a>.
            </p>
          </Method>
        </Section>

        <Section
          id="rss"
          title="As a feed"
          line="The same record, newest first, for a feed reader — a declaration dated by when it was first seen, a change by when it took effect."
        >
          <p className="subscribe">
            <span className="subscribe-hint">
              Paste this address into your reader — Feedly, NetNewsWire, Inoreader, or any other:{' '}
              <code>{feedUrl}</code>
            </span>
          </p>
          <Method title="What a reader will show">
            <p>
              One entry per declared dividend and one per observed change, each linking to the
              token&rsquo;s page. Nothing is annualised or projected in the feed either: an entry is
              a fact with a date. The file itself: <a href="/feed.xml">feed.xml</a>.
            </p>
          </Method>
        </Section>

        <Section
          id="badges"
          title="On a page of your own"
          line="A small image that states the latest measured figure, for a README, a wiki or a dashboard. It updates with the record; the page it sits on does not have to."
        >
          <div className="embed">
            <p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="badge" src="/badge.svg" alt={badgeAlt} height={20} />
            </p>
            <Method title="How to embed it">
            <p>Markdown, for a README or a wiki:</p>
            <pre tabIndex={0} role="region" aria-label="Markdown for the exdate badge">
              <code>{badgeMarkdown}</code>
            </pre>
            <p>HTML, for anywhere else:</p>
            <pre tabIndex={0} role="region" aria-label="HTML for the exdate badge">
              <code>{badgeHtml}</code>
            </pre>
            <p>
              Every one of the {listed.tokens} tokens has its own badge, on its page under
              &ldquo;Embed this token&rsquo;s badge&rdquo;. The site-wide image itself:{' '}
              <a href="/badge.svg">badge.svg</a>.
            </p>
            </Method>
          </div>
        </Section>

        <Section
          id="tokenlist"
          title="In a wallet"
          line={`A token list is a file a wallet or an aggregator imports from an address to learn which tokens exist. This one carries all ${listed.tokens} Stock Tokens — version ${listed.version}, built ${dateLong(listed.builtAt)}.`}
        >
          <p className="subscribe">
            <span className="subscribe-hint">
              In a wallet that imports lists by URL — most that support the Uniswap token-list
              standard do — paste: <code>{listUrl}</code>
            </span>
          </p>
          <Method title="What a wallet learns from it">
            <p>
              Beside each token&rsquo;s name, symbol and address, what nobody else publishes: how
              many underlying shares one token represents today, whether a dividend is declared
              and not yet on chain and what it owes per token, its ISIN, CUSIP and share-class
              FIGI, and the Chainlink price feed a lending market would use — or none, for the
              tokens that have none. No logo: the issuer&rsquo;s marks are not exdate&rsquo;s to
              redistribute.
            </p>
            <p>
              The version moves the way the standard reads it: a token removed is a major change,
              one added is minor, a detail is a patch. The file itself:{' '}
              <a href="/tokenlist.json">tokenlist.json</a>.
            </p>
          </Method>
        </Section>

        <section className="block tight" aria-label="Also">
          <div className="wrap">
            <Links ariaLabel="Also">
              <a href="/docs/api/#webhooks">Signed webhooks, for a program</a>
              <a href="/data/">The data behind every figure</a>
            </Links>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
