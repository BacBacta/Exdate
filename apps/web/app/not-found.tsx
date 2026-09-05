import { Footer, Nav } from './components/Chrome'
import { Finder } from './components/Finder'
import { observed } from '../lib/observed'

/**
 * The page behind every link that does not resolve - and, measured on
 * 2026-09-05, that was every token link carrying the address as an explorer,
 * a wallet or the issuer's registry displays it. Token pages are generated
 * under the lowercase address only, and `/t/0x92FD…9B5/` answered "This page
 * could not be found" with nothing to do next.
 *
 * Two answers. First, a token URL in any other casing is rewritten to
 * lowercase before the page paints: on a static host this file IS the 404, so
 * the redirect lives here rather than in a server rule that cannot lowercase.
 * Second, whatever brought someone here, the finder is on the page, because a
 * dead end with a search box is a page and a dead end without one is a wall.
 */
const REDIRECT = `(function(){var m=/^\\/t\\/(0x[0-9a-fA-F]{40})\\/?$/.exec(location.pathname);if(m&&m[1]!==m[1].toLowerCase()){location.replace('/t/'+m[1].toLowerCase()+'/'+location.search+location.hash)}})()`

export default function NotFound() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: REDIRECT }} />
      <Nav />
      <main id="main">
        <section className="hero" aria-labelledby="nf-title">
          <div className="wrap not-found">
            <p className="token-kind">Not found</p>
            <h1 id="nf-title">There is no page at this address.</h1>
            <p className="lede">
              If you pasted a token&rsquo;s contract address, it should have landed on its page. It
              did not, so find the token by name, ticker or address instead.
            </p>
            <div className="hero-find">
              <Finder tokens={observed.tokens} />
            </div>
            <p className="finder-hint">
              Or go to <a href="/">the front page</a>, <a href="/wallet/">your wallet</a> or{' '}
              <a href="/calendar/">the calendar</a>.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
