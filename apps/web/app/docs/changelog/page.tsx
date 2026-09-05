import type { Metadata } from 'next'
import { Footer, Nav } from '../../components/Chrome'
import { renderDoc } from '../../../lib/docs'

export const metadata: Metadata = {
  title: 'Changelog — exdate',
  description: 'What changed in the exdate API, the SDK and the published files, by date.',
}

export default function Page() {
  const doc = renderDoc('docs/changelog.md')
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
