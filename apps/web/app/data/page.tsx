import type { Metadata } from 'next'
import { Footer, Nav } from '../components/Chrome'
import { dateLong } from '../../lib/format'
import { datasets } from '../../lib/docs'

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
  return (
    <>
      <Nav />
      <main id="main">
        <section className="hero token-hero" aria-labelledby="data-title">
          <div className="wrap">
            <div data-reveal>
              <p className="token-kind">The record behind every figure</p>
              <h1 id="data-title">Data</h1>
            </div>
            <p className="lede" data-reveal>
              Every number on this site is read at build time from one of these files. They are
              committed with their dates, and served here as they are.
            </p>
          </div>
        </section>
        <section className="block tight" aria-label="Datasets">
          <div className="wrap">
            <ul className="datasets">
              {files.map((dataset) => (
                <li key={dataset.file}>
                  <a href={`/data/${dataset.file}`}>{dataset.file}</a>
                  <p>{dataset.what}</p>
                  <span className="meta">
                    {dataset.observedAt ? `${dateLong(dataset.observedAt)} · ` : ''}
                    {kb(dataset.bytes)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="note-box">
              Rebuilt by the scripts in the repository; nothing here is typed by hand. The
              corporate-action archive and the session samples grow on a schedule, the rest when a
              scan is rerun.
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
