import { DOCS, rawDoc } from '../../../lib/docs'

/**
 * Each document as Markdown, at /docs/api.md, /docs/sdk.md and
 * /docs/changelog.md: for a reader who wants the source, and for a tool
 * that reads text better than HTML.
 */
export const dynamic = 'force-static'
export const dynamicParams = false

export function generateStaticParams() {
  return DOCS.map((doc) => ({ file: doc.raw.split('/').at(-1)! }))
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  const doc = DOCS.find((entry) => entry.raw.endsWith(`/${file}`))
  if (!doc) return new Response('Not found', { status: 404 })
  return new Response(rawDoc(doc.file), { headers: { 'content-type': 'text/markdown; charset=utf-8' } })
}
