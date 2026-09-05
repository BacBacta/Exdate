import type { Metadata } from 'next'
import { DocPage } from '../../components/DocPage'
import { renderDoc } from '../../../lib/docs'

export const metadata: Metadata = {
  title: 'SDK — exdate',
  description: 'The @exdate/sdk client: every route typed, the webhook verifier, and what the two endpoints worth knowing return.',
}

export default function Page() {
  return <DocPage doc={renderDoc('packages/sdk/README.md')} current="/docs/sdk/" />
}
