import type { Metadata } from 'next'
import { DocPage } from '../../components/DocPage'
import { renderDoc } from '../../../lib/docs'

export const metadata: Metadata = {
  title: 'Méthode de mesure — exdate',
  description:
    "Comment exdate compare un dividende déclaré au pas de multiplicateur qu'il a produit : appariement, prix, calcul, états de refus et échelle de confiance. Généré depuis les constantes du code.",
}

export default function Page() {
  return <DocPage doc={renderDoc('docs/methodology.md')} current="/docs/methodology/" />
}
