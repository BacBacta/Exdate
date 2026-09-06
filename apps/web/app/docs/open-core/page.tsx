import type { Metadata } from 'next'
import { DocPage } from '../../components/DocPage'
import { renderDoc } from '../../../lib/docs'

export const metadata: Metadata = {
  title: 'The open-core boundary — exdate',
  description:
    'Which side of the line every route, dataset and field is on. Nothing is reserved today, and the reasons are measurements: generated from the API’s own source, the quotas, the licence and the committed record.',
}

export default function Page() {
  return <DocPage doc={renderDoc('docs/open-core.md')} current="/docs/open-core/" />
}
