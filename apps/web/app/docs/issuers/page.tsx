import type { Metadata } from 'next'
import { DocPage } from '../../components/DocPage'
import { renderDoc } from '../../../lib/docs'

export const metadata: Metadata = {
  title: 'What each issuer actually does — exdate',
  description:
    'Robinhood, Coinbase B20 and Backed xStocks, one row each, read on chain rather than from the page — and three more issuers listed as unread. The constant view and the adjusted one are inverted between the first two that have real events.',
}

export default function Page() {
  return <DocPage doc={renderDoc('docs/issuer-mechanisms.md')} current="/docs/issuers/" />
}
