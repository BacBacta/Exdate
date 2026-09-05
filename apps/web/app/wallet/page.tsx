import type { Metadata } from 'next'
import { Footer, Nav } from '../components/Chrome'
import { Wallet } from '../components/Wallet'
import { observed, wallet } from '../../lib/observed'

/**
 * The one page that reads the chain at runtime, in the visitor's browser:
 * what an address holds cannot be committed in advance. Everything it joins
 * that reading with (names, declared dividends, dates) is the committed data.
 */
export const metadata: Metadata = {
  title: 'Your wallet — exdate',
  description:
    'Paste an address and see every Robinhood Stock Token it holds, the shares they represent today, and what each declared dividend would owe it. No signature.',
}

export default function Page() {
  return (
    <>
      <Nav current="wallet" />
      <main id="main">
        <section className="hero token-hero" aria-labelledby="wallet-title">
          <div className="wrap">
            <p className="token-kind">Any Robinhood Chain address</p>
            <h1 id="wallet-title">What your wallet holds. What it is owed.</h1>
          </div>
        </section>

        <section className="block" aria-label="Wallet reader">
          <div className="wrap">
            <Wallet
              tokens={observed.tokens}
              declaredByToken={wallet.declaredByToken}
              rpcUrl={wallet.rpcUrl}
              archiveRpcUrl={wallet.archiveRpcUrl}
              multicall3={wallet.multicall3}
              blockNumberSource={wallet.blockNumberSource}
              steps={wallet.steps}
              scan={wallet.scan}
            />
            {/* The method, one click away rather than under the results (F13). */}
            <details className="method">
              <summary>How this is read</summary>
              <p>
                <em>Shares represented</em> is the balance times the multiplier in force, read at the
                same block. <em>Owed</em> is the issuer&rsquo;s declared rate times those shares: what a
                full payment would deliver, with no price involved. What actually arrives is measured on
                each token&rsquo;s page once the step lands.
              </p>
              <p>
                Below the holdings, what past dividends delivered to this address is read at the block each
                change took effect: from a public archive node when one qualifies, otherwise rebuilt from the
                address&rsquo;s own transfers on Robinhood&rsquo;s node. Tokens held inside a protocol at the
                time are not seen.
              </p>
            </details>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
