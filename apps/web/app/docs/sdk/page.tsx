import type { Metadata } from 'next'
import { Footer, Nav } from '../../components/Chrome'
import { renderDoc } from '../../../lib/docs'

export const metadata: Metadata = {
  title: 'SDK — exdate',
  description: 'The typed client and webhook verifier for the exdate API.',
}

export default function Page() {
  const doc = renderDoc('packages/sdk/README.md')
  return (
    <>
      <Nav current="developers" />
      <main id="main">
        <div className="wrap">
          <article className="prose" dangerouslySetInnerHTML={{ __html: doc.html }} />
        </div>
      </main>
      <Footer />
    </>
  )
}
