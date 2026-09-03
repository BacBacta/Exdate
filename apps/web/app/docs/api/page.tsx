import type { Metadata } from 'next'
import { Footer, Nav } from '../../components/Chrome'
import { renderDoc } from '../../../lib/docs'

export const metadata: Metadata = {
  title: 'API reference — exdate',
  description: 'Every route of the exdate API with a real captured response, the keys and quotas, and how to run your own.',
}

export default function Page() {
  const doc = renderDoc('docs/api.md')
  return (
    <>
      <Nav />
      <main id="main">
        <div className="wrap">
          <article className="prose" dangerouslySetInnerHTML={{ __html: doc.html }} />
        </div>
      </main>
      <Footer />
    </>
  )
}
