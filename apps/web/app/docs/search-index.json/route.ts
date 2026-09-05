import { docsIndex } from '../../../lib/docs'

/** Every section of every document, for the search box. One static file, built with the site. */
export const dynamic = 'force-static'

export function GET() {
  return new Response(JSON.stringify(docsIndex()), { headers: { 'content-type': 'application/json; charset=utf-8' } })
}
