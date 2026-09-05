import type { Metadata } from 'next'
import { Footer, Nav } from '../components/Chrome'
import { delay } from '../../lib/format'
import { observed } from '../../lib/observed'

/**
 * The developer's door: what exists, in what form, and where each thing is.
 * The home page used to carry this block and a code sample; a developer
 * now gets one page named for them (audit 2026-09-05, F06).
 */
export const metadata: Metadata = {
  title: 'Developers — exdate',
  description:
    'The exdate API, SDK, signed webhooks, token list, calendar and data: every value exact, anything not observed null, all of it over the same committed records.',
}

const { links, counts } = observed

export default function Page() {
  return (
    <>
      <Nav current="developers" />
      <main id="main">
        <section className="hero token-hero" aria-labelledby="dev-title">
          <div className="wrap">
            <div data-reveal>
              <p className="token-kind">For wallets, lending markets and aggregators</p>
              <h1 id="dev-title">Built to integrate.</h1>
            </div>
            <p className="lede" data-reveal style={delay(120)}>
              A REST API, a typed SDK and signed webhooks over the same records the site reads. Every
              bigint is a decimal string; anything exdate has not observed is <code>null</code>, never
              zero. The token list imports the whole registry into a wallet in one URL, carrying what each
              token represents in shares and what it is owed.
            </p>
          </div>
        </section>

        <section className="block tight dev" aria-label="What there is">
          <div className="wrap dev-grid">
            <div data-reveal>
              <ul className="doors">
                <li>
                  <a href={links.apiDocs}>
                    <h2>API reference</h2>
                    <p>Every route with a real captured response. Opens on a first call in 30 seconds.</p>
                  </a>
                </li>
                <li>
                  <a href={links.sdkDocs}>
                    <h2>SDK</h2>
                    <p>
                      <code>@exdate/sdk</code> on npm, with provenance: a typed client and the webhook verifier.
                    </p>
                  </a>
                </li>
                <li>
                  <a href="/tokenlist.json">
                    <h2>Token list</h2>
                    <p>{counts.tokens} tokens, with shares per token, what is owed, and the Chainlink proxy, as extensions.</p>
                  </a>
                </li>
                <li>
                  <a href={links.data}>
                    <h2>Data</h2>
                    <p>The committed observations behind every figure, as JSON, under CC BY 4.0.</p>
                  </a>
                </li>
                <li>
                  <a href="/calendar.ics">
                    <h2>Calendar and feed</h2>
                    <p>
                      <code>/calendar.ics</code>, one per token at <code>/t/&lt;address&gt;/calendar.ics</code>, and{' '}
                      <code>/feed.xml</code>.
                    </p>
                  </a>
                </li>
                {links.api ? (
                  <li>
                    <a href={`${links.api}/v1/health`}>
                      <h2>Live API</h2>
                      <p>{links.api.replace(/^https?:\/\//, '')}, one small machine, 60 requests a minute without a key.</p>
                    </a>
                  </li>
                ) : null}
              </ul>
              <p className="licence">
                exdate&rsquo;s observations are <a href={links.data}>CC BY 4.0</a>; the code is MIT.
                {links.github ? (
                  <>
                    {' '}
                    <a href={links.github}>Source</a> and <a href={`${links.github}/issues`}>issues</a> on GitHub.
                  </>
                ) : null}
                {links.status ? (
                  <>
                    {' '}
                    <a href={links.status}>Live status</a>.
                  </>
                ) : null}
              </p>
            </div>
            <pre className="code" data-reveal style={delay(120)} tabIndex={0} role="region" aria-label="Example: reading what a token is owed with the SDK">
              <code>
                {`import { createClient } from '@exdate/sdk'\n\n`}
                {`const exdate = createClient({ baseUrl: 'https://api.exdate.me' })\n`}
                {`const owed = await exdate.pending(token)\n\n`}
                {`owed.declared[0].grossPerToken\n`}
                <span className="c">{`// what is owed per token, no price needed`}</span>
                {`\n\nowed.notComputed\n`}
                <span className="c">{`// what it refuses to estimate, and why`}</span>
              </code>
            </pre>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
