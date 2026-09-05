import { calendarIcs } from '../../lib/feeds'

/**
 * A file to subscribe to. Generated at build with the rest of the site, so it
 * is a static file on the host and needs no server; a calendar client polls
 * it, and the site rebuilds on every commit to data/.
 */
export const dynamic = 'force-static'

export function GET() {
  return new Response(calendarIcs(), {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'inline; filename="exdate.ics"' },
  })
}
