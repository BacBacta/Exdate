import { tokenBadge } from '../../../lib/badge'
import { observed } from '../../../lib/observed'

/**
 * One badge per token at /badge/<address>.svg. The dynamic segment carries the
 * extension so the export writes a file a browser will treat as an image.
 */
export const dynamic = 'force-static'
export const dynamicParams = false

export function generateStaticParams() {
  return observed.tokens.map((token) => ({ file: `${token.address.toLowerCase()}.svg` }))
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  const body = tokenBadge(file.replace(/\.svg$/, ''))
  if (body === null) return new Response('Not found', { status: 404 })
  return new Response(body, { headers: { 'content-type': 'image/svg+xml; charset=utf-8' } })
}
