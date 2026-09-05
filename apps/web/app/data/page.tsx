import type { Metadata } from 'next'
import { Footer, Nav } from '../components/Chrome'
import { dateLong } from '../../lib/format'
import { datasets } from '../../lib/docs'
import { observed } from '../../lib/observed'

/**
 * The committed observations, served by the site itself. Every figure on
 * every page comes from one of these files, so a reader can check any number
 * against its source without a GitHub account.
 */
export const metadata: Metadata = {
  title: 'Data — exdate',
  description: 'The committed observations behind every figure on the site, as JSON, with their dates.',
}

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`

export default function Page() {
  const files = datasets()
  const github = observed.links.github
  return (
    <>
      <Nav current="developers" />
      <main id="main">
        <section className="hero token-hero" aria-labelledby="data-title">
          <div className="wrap">
            <div data-reveal>
              <p className="token-kind">The record behind every figure</p>
              <h1 id="data-title">Data</h1>
            </div>
            <p className="lede" data-reveal>
              Every number on this site is read at build time from one of these files. They are
              committed with their dates, and served here as they are — except the issuer's own,
              which stay in the repository.
            </p>
          </div>
        </section>
        <section className="block tight" aria-label="Datasets">
          <div className="wrap">
            <ul className="datasets">
              {files.map((dataset) => (
                <li key={dataset.file}>
                  {dataset.issuer ? (
                    github ? (
                      <a href={`${github}/blob/HEAD/data/${dataset.file}`}>{dataset.file}</a>
                    ) : (
                      <span>{dataset.file}</span>
                    )
                  ) : (
                    <a href={`/data/${dataset.file}`}>{dataset.file}</a>
                  )}
                  <p>{dataset.what}</p>
                  <span className="meta">
                    {dataset.observedAt ? `${dateLong(dataset.observedAt)} · ` : ''}
                    {kb(dataset.bytes)}
                    {dataset.issuer ? ' · the issuer’s data, in the repository only' : ''}
                  </span>
                </li>
              ))}
            </ul>
            <p className="note-box">
              Rebuilt by the scripts in the repository; nothing here is typed by hand. The
              corporate-action archive and the session samples grow on a schedule, the rest when a
              scan is rerun.
            </p>
            <p className="note-box">
              exdate’s own observations are licensed under{' '}
              <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>: use them,
              republish them, build on them, and say where they came from. The grant does not cover
              the issuer’s files above, nor the issuer’s fields inside the files that are built on
              them — each of those names its own <code>sources</code> — that content is Robinhood’s,
              reproduced as the input each measurement is checked against, under a licence exdate
              cannot pass on.
              {github ? (
                <>
                  {' '}
                  Full text: <a href={`${github}/blob/HEAD/DATA-LICENSE.md`}>DATA-LICENSE.md</a>.
                </>
              ) : null}
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
