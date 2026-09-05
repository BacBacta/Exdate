import type { Metadata } from 'next'
import { DocPage } from '../../components/DocPage'
import { renderDoc } from '../../../lib/docs'

export const metadata: Metadata = {
  title: 'Changelog — exdate',
  description: 'What changed in the exdate API, the SDK and the published files, by date.',
}

export default function Page() {
  return <DocPage doc={renderDoc('docs/changelog.md')} current="/docs/changelog/" />
}
