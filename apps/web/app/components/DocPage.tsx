import { Footer, Nav } from './Chrome'
import { CodeCopy } from './CodeCopy'
import { DocNav } from './DocNav'
import { DocSearch } from './DocSearch'
import { DOCS, type DocPage as DocPath, type RenderedDoc } from '../../lib/docs'

/**
 * The shell every rendered document gets: a sidebar with search, the
 * document's own sections, the other documents and the Markdown source; the
 * article; and a copy button on each code block. The sidebar is built at
 * render from the headings, so it cannot disagree with the page; the parts
 * that need a browser (the current section, the search, the copy buttons)
 * enhance a page that stands complete without them.
 */
/**
 * A route heading in the sidebar reads as its path after /v1, without the
 * method and the chain segment: `tokens/:address/pending` rather than a
 * line that wraps mid-word in a 240px column. The article keeps the whole
 * heading.
 */
const label = (text: string) =>
  text
    .split(' · ')
    .map((part) => part.replace(/^(?:GET|POST|DELETE)\s+\/v1\//, '').replace(/^:chain\//, ''))
    .join(' · ')

export function DocPage({ doc, current }: { doc: RenderedDoc; current: DocPath }) {
  const here = DOCS.find((entry) => entry.page === current)!
  const toc = (
    <ol className="toc-list">
      {doc.headings.map((heading) => (
        <li key={heading.id} className={heading.level === 3 ? 'sub' : undefined}>
          <a href={`#${heading.id}`}>{label(heading.text)}</a>
        </li>
      ))}
    </ol>
  )
  return (
    <>
      <Nav current="developers" />
      <main id="main">
        <div className="wrap doc-layout">
          <aside className="doc-side">
            <DocSearch />
            {/* On a narrow screen the sections fold under one line; on a wide one they stay open beside the text. */}
            <details className="toc toc-mobile">
              <summary>On this page</summary>
              {toc}
            </details>
            <nav className="toc toc-desktop" aria-label="On this page">
              <p className="toc-title">On this page</p>
              {toc}
            </nav>
            <nav className="doc-others" aria-label="Documents">
              <p className="toc-title">Documents</p>
              {DOCS.map((entry) => (
                <a key={entry.page} href={entry.page} aria-current={entry.page === current ? 'page' : undefined}>
                  {entry.name}
                </a>
              ))}
              <a href="/docs/">Developers</a>
              <a className="raw" href={here.raw}>
                This page as Markdown
              </a>
            </nav>
          </aside>
          <article className="prose" dangerouslySetInnerHTML={{ __html: doc.html }} />
        </div>
        <DocNav />
        <CodeCopy />
      </main>
      <Footer />
    </>
  )
}
