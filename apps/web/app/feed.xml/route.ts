import { rssFeed } from '../../lib/feeds'

/** The record as a feed, newest first. Static like everything else here. */
export const dynamic = 'force-static'

export function GET() {
  return new Response(rssFeed(), { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } })
}
