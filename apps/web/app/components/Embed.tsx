/**
 * The badge and the two lines that paste it. Shown closed: a holder does not
 * need it, a maintainer of a README or a dashboard does. Both snippets carry
 * the canonical host, because a relative URL means nothing off this site.
 */
export function Embed({ site, address, name, alt }: { site: string; address: string; name: string; alt: string }) {
  const img = `${site}/badge/${address}.svg`
  const page = `${site}/t/${address}/`
  const markdown = `[![${alt}](${img})](${page})`
  const html = `<a href="${page}"><img src="${img}" alt="${alt}"></a>`
  return (
    <details className="method embed">
      <summary>Embed this token&rsquo;s badge</summary>
      <p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="badge" src={`/badge/${address}.svg`} alt={alt} height={20} />
      </p>
      <p>Updated with the record: the badge says what the page says, at the moment it is loaded.</p>
      <pre tabIndex={0} role="region" aria-label={`Markdown for the ${name} badge`}>
        <code>{markdown}</code>
      </pre>
      <pre tabIndex={0} role="region" aria-label={`HTML for the ${name} badge`}>
        <code>{html}</code>
      </pre>
    </details>
  )
}
