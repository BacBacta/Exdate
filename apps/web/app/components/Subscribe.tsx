/**
 * The two ways to be told rather than to remember: a calendar file, and the
 * same as a feed. The webcal: scheme is what makes a calendar app subscribe
 * instead of importing once; it has to be absolute, so the canonical host is
 * passed in. Google Calendar takes the https URL pasted under "From URL",
 * which the line says.
 */
export function Subscribe({ icsPath, site, what }: { icsPath: string; site: string; what: string }) {
  const https = `${site}${icsPath}`
  const webcal = https.replace(/^https?:\/\//, 'webcal://')
  return (
    <p className="subscribe">
      <a className="btn" href={webcal}>
        Subscribe in your calendar
      </a>
      <a href={icsPath} download>
        Download .ics
      </a>
      <a href="/feed.xml">RSS</a>
      <span className="subscribe-hint">
        A calendar of {what}, updated as the record is. In Google Calendar, add it from URL:{' '}
        <code>{https}</code>
      </span>
    </p>
  )
}
