import type { Metadata } from 'next'
import { DocPage } from '../../components/DocPage'
import { renderDoc } from '../../../lib/docs'

export const metadata: Metadata = {
  title: 'API reference — exdate',
  description: 'Every route of the exdate API with a real captured response, the keys and quotas, and how to run your own.',
}

export default function Page() {
  return <DocPage doc={renderDoc('docs/api.md')} current="/docs/api/" />
}
