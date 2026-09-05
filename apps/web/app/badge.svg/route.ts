import { siteBadge } from '../../lib/badge'

/** The site's badge: the headline figure, as a file to paste anywhere. */
export const dynamic = 'force-static'

export function GET() {
  return new Response(siteBadge(), { headers: { 'content-type': 'image/svg+xml; charset=utf-8' } })
}
