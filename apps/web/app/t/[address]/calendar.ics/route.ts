import { tokenCalendarIcs, tokensWithCalendar } from '../../../../lib/feeds'

/** One calendar per token that has something to put in one; the page links it only for those. */
export const dynamic = 'force-static'
export const dynamicParams = false

export function generateStaticParams() {
  return tokensWithCalendar.map((address) => ({ address }))
}

export async function GET(_request: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params
  const body = tokenCalendarIcs(address)
  if (body === null) return new Response('Not found', { status: 404 })
  return new Response(body, {
    headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `inline; filename="exdate-${address}.ics"` },
  })
}
