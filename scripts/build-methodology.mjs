// The methodology note, generated from the constants it describes.
//
//   node --experimental-strip-types scripts/build-methodology.mjs
//   node --experimental-strip-types scripts/build-methodology.mjs --check
//
// A note written beside the code drifts from it. This project measured that four times on
// 2026-09-05 alone - a repository note quoting 22 corroborated pairings where the file said 20, an
// endpoint count that had been true a day earlier, a licence clause describing a `source` field the
// served files did not carry, an API reference pointing at a field only one route served. A
// document that researchers and journalists are invited to cite cannot be the fifth.
//
// So every number below is imported from the module that defines it, and `--check` regenerates and
// diffs. Changing a constant in the code and not the note turns CI red; changing the note by hand
// does too. The prose lives here, in the generator, which is the only copy.
//
// The modules are imported by their `.ts` path rather than through the package index: core's
// internal imports use `.js` specifiers that only a bundler or a compiler resolves, so a plain
// script can load a leaf module and not the barrel. `method.ts` exists for exactly this reason.
import { readFileSync, writeFileSync } from 'node:fs'
import { MATCH_WINDOW_DAYS } from '../packages/core/src/pairing.ts'
import { QUOTE_TOLERANCE_SECONDS } from '../packages/core/src/quotes.ts'
import {
  CORROBORATION_MAJORITY,
  CORROBORATION_MINIMUM_SAMPLES,
  MINIMUM_SEPARATION,
  SEPARATION_FLOOR_BPS,
} from '../packages/core/src/pools.ts'
import { FEED_HEARTBEAT_SECONDS } from '../packages/core/src/chains.ts'
import { WEBHOOK_MAX_ATTEMPTS, WEBHOOK_RETRY_SCHEDULE_SECONDS, WEBHOOK_TOLERANCE_SECONDS } from '../packages/core/src/webhooks.ts'
import { WAD } from '../packages/core/src/multiplier.ts'
import { CONFIDENCE_MIN_EVENTS_HIGH, CONFIDENCE_MIN_EVENTS_MEDIUM, PLAUSIBLE_HAIRCUT_BPS } from '../packages/core/src/method.ts'

const root = new URL('../', import.meta.url)
const OUT = new URL('docs/methodology.md', root)

/**
 * The version. Not a date: a citation has to survive the next hourly commit, and a note that
 * changes its identity whenever a collector runs is not citable. It moves only when a constant
 * moves, so it is derived from the constants themselves.
 */
const CONSTANTS = {
  matchWindowDays: MATCH_WINDOW_DAYS,
  plausibleHaircutBps: PLAUSIBLE_HAIRCUT_BPS,
  quoteToleranceSeconds: QUOTE_TOLERANCE_SECONDS,
  minimumSeparation: MINIMUM_SEPARATION,
  separationFloorBps: SEPARATION_FLOOR_BPS,
  corroborationMinimumSamples: CORROBORATION_MINIMUM_SAMPLES,
  corroborationMajority: CORROBORATION_MAJORITY,
  feedHeartbeatSeconds: FEED_HEARTBEAT_SECONDS,
  webhookToleranceSeconds: WEBHOOK_TOLERANCE_SECONDS,
  webhookMaxAttempts: WEBHOOK_MAX_ATTEMPTS,
  confidenceMinEventsMedium: CONFIDENCE_MIN_EVENTS_MEDIUM,
  confidenceMinEventsHigh: CONFIDENCE_MIN_EVENTS_HIGH,
  wad: WAD.toString(),
}
const fingerprint = (() => {
  let hash = 0n
  for (const byte of Buffer.from(JSON.stringify(CONSTANTS))) hash = (hash * 131n + BigInt(byte)) % (2n ** 32n)
  return hash.toString(16).padStart(8, '0')
})()

const hours = (seconds) => `${Math.round(seconds / 3600)} h`
const pct = (fraction) => `${Math.round(fraction * 100)} %`

const note = `# Méthode de mesure — exdate

**Version \`m-${fingerprint}\`.** Ce document est **généré** par \`scripts/build-methodology.mjs\`
depuis les constantes du code qu'il décrit ; il n'est pas rédigé à côté d'elles. Sa version change
quand un paramètre change, jamais quand une donnée change — une citation doit survivre au prochain
commit d'un collecteur. Le régénérer sans rien modifier ne produit aucune différence, et la CI le
vérifie à chaque commit touchant le code ou la donnée.

Écrit pour être cité et refait. Chaque paramètre ci-dessous nomme le module qui le définit.

## 1. Ce qui est mesuré

Un dividende sur un Stock Token n'arrive pas en espèces. L'émetteur le réinvestit et relève un
**multiplicateur** porté par le jeton : le nombre de jetons ne bouge pas, la quantité de sous-jacent
qu'ils représentent augmente. exdate compare **ce que l'émetteur a déclaré** verser à **ce que le pas
de multiplicateur a effectivement délivré**, et publie l'écart — la *décote effective*.

Rien n'est estimé, projeté ni annualisé. Une valeur non observée est absente et porte un motif de
refus, jamais un zéro.

## 2. Les deux côtés de la comparaison

**Le déclaré** vient du registre d'actions de société de l'émetteur : un taux par action sous-jacente
et une date de traitement. exdate en tient une **archive cumulative** parce que la fenêtre de
l'émetteur fait environ un mois sans pagination : une ligne qui en sort n'est récupérable nulle part.

**L'observé** vient de la chaîne : le journal \`UIMultiplierUpdated\`, émis **une seule fois, à
l'annonce**, portant une date d'effet future. **Rien n'est émis quand le changement prend effet** —
propriété d'ERC-8056, vérifiée ici puis confirmée par le journal des modifications de Base. Le pas
est donc lu dans l'état de la chaîne, \`uiMultiplier()\` au bloc précédant la date d'effet et au bloc
lui-même, chez un point d'accès d'archive.

## 3. L'appariement

Une action déclarée est appariée au pas qu'elle a produit si les deux portent la même adresse et si
la date d'effet tombe dans une fenêtre de **${MATCH_WINDOW_DAYS} jours calendaires** après la date de
traitement (\`packages/core/src/pairing.ts\`). Quatre jours et non un, parce que le décalage observé
est « le jour ouvré suivant » et qu'un vendredi ou un week-end férié le repousse de trois ou quatre
jours calendaires.

L'appariement est **un pour un, au plus proche d'abord**. Une action est identifiée par
\`(identifiant émetteur, date de traitement)\` et non par l'identifiant seul : chez cet émetteur
l'identifiant nomme une *série* de dividendes, et trois séries portent le même sur deux mois.

## 4. Le prix

La décote est un rapport entre un montant déclaré et un montant délivré, et le second n'existe qu'en
actions : il faut un prix du sous-jacent **à l'instant du pas**.

Deux sources, dans cet ordre.

1. **La cotation de l'émetteur, capturée à l'instant** (\`/rhj/prices\`). Retenue si elle tombe à
   moins de **${QUOTE_TOLERANCE_SECONDS} secondes** de la date d'effet (\`packages/core/src/quotes.ts\`).
   Une cotation publiée pendant une suspension de cotation est **refusée** : c'est un dernier cours,
   pas un marché.
2. **La ronde Chainlink en vigueur**, sinon. Le flux publie un prix *total return* — il **contient
   déjà** le multiplicateur — donc le multiplicateur en vigueur avant le pas en est retiré pour
   obtenir le prix de l'action. Multiplier un prix Chainlink par le multiplicateur serait le compter
   deux fois.

Un flux gèle hors séance : son âge est lu et publié, et au-delà de son intervalle de publication de
**${hours(FEED_HEARTBEAT_SECONDS)}** la ronde est étiquetée périmée plutôt qu'utilisée en silence.

## 5. Le calcul

En arithmétique entière, en WAD (${WAD.toString()} = 1,0). Aucun flottant n'intervient dans un
résultat publié.

\`\`\`
pas observé      = (nouveau multiplicateur − ancien) / ancien
prix sous-jacent = prix du jeton / multiplicateur en vigueur      (source Chainlink)
                 = la cotation telle quelle                        (source émetteur)
pas attendu      = taux déclaré / prix sous-jacent
reçu par action  = pas observé × prix sous-jacent
décote (pb)      = (taux déclaré − reçu) / taux déclaré × 10 000
\`\`\`

La décote publiée est **tronquée** vers zéro ; \`impliedHaircutBpsExact\` porte la même valeur à deux
décimales. Le prix stocké est la réponse entière de l'agrégateur, jamais un arrondi d'affichage.

## 6. Quand une ligne n'est pas une mesure

| État | Ce qu'il signifie |
|---|---|
| \`matched\` | déclaré et observé appariés, prix disponible, décote dans la bande |
| \`anomaly\` | décote hors de la bande **${PLAUSIBLE_HAIRCUT_BPS[0]} à ${PLAUSIBLE_HAIRCUT_BPS[1]} pb**, ou aucun prix : le modèle de réinvestissement ne décrit pas l'événement |
| \`pending\` | déclaré, aucun pas observé sur la chaîne |
| \`unmatched\` | pas observé, aucune ligne émetteur — la fenêtre d'un mois avait déjà tourné |
| \`unsupported_action_type\` | apparié, mais l'émetteur ne déclare aucun ratio à comparer |

La bande (\`packages/core/src/method.ts\`) contient les 30 % de retenue à la source américaine pour
non-résidents et les 34–36 % observés, et rejette 90 %. C'est une borne de présentation, jamais une
affirmation sur ce qui serait correct.

## 7. La confiance, et ce qu'elle porte

Aucune source de première main ne relie une adresse de jeton à une adresse de flux Chainlink. Le
lien est donc une inférence, et l'échelle le dit (\`packages/core/src/reconcile.ts\`) :

- **\`low\`** — appariement par ticker seul, ou moins de **${CONFIDENCE_MIN_EVENTS_MEDIUM}** pas observés sur ce jeton.
- **\`medium\`** — corroboré par le comportement, à partir de ${CONFIDENCE_MIN_EVENTS_MEDIUM} pas.
- **\`high\`** — exigerait une déclaration de première main au niveau de l'adresse, et **${CONFIDENCE_MIN_EVENTS_HIGH}** pas. **Rien ne l'atteint.**

Deux corroborations différentes mènent à \`medium\`, et la ligne **nomme laquelle** plutôt que de
laisser la plus faible emprunter la tenue de la plus forte :

- **\`multiplier-step\`** — causale. Le pas du jeton a été vu déplacer ce flux de sa propre taille,
  au-dessus du bruit du flux, sans qu'aucun autre flux cartographié soit plus proche.
- **\`traded-price\`** — d'identification. Le prix traité du jeton est plus proche de ce flux que de
  tout autre, d'un facteur d'au moins **${MINIMUM_SEPARATION}×**, sur une majorité d'au moins
  **${CORROBORATION_MINIMUM_SAMPLES}** relevés (seuil : ${pct(CORROBORATION_MAJORITY)}). Un rapport et non une
  distance, parce qu'un flux gelé hors séance est loin pour une raison légitime alors que le
  classement survit ; la distance du flux assigné a un plancher de ${SEPARATION_FLOOR_BPS} pb pour
  qu'une correspondance quasi exacte ne rende pas le rapport insignifiant. Plus faible par
  construction : deux actifs sans rapport peuvent coter au même prix.

## 8. Ce qui est exclu, et pourquoi

- **Les actions dont la ligne émetteur a disparu** avant l'archive : leur pas est sur la chaîne, leur
  taux déclaré n'existe plus nulle part. Publiées \`unmatched\`, jamais complétées.
- **Les pas sans cotation à l'instant** : l'émetteur ne sert que le présent, donc le prix d'un
  instant passé est perdu. Publiés avec le motif du refus.
- **Les jetons sans flux Chainlink** — la majorité : un pas est observé, aucune décote n'en est
  tirée.
- **Toute date d'atterrissage, tout taux annualisé, toute projection.** Le préavis mesuré est
  d'environ dix minutes ; il ne permet pas de prédire une date, et rien n'en est déduit.

## 9. Ce que la donnée publiée garantit

- Chaque chiffre trace vers un fichier committé, daté, et vers le script qui l'a produit.
- L'historique est interrogeable : \`data/history/\` dit ce que le registre affirmait à un instant
  donné, index dérivé de git et rejouable (\`node scripts/build-history.mjs --as-of <iso>\`).
- Les livraisons de webhooks sont signées en HMAC-SHA256 avec une fenêtre anti-rejeu de
  **${WEBHOOK_TOLERANCE_SECONDS} secondes** et **${WEBHOOK_MAX_ATTEMPTS} tentatives** échelonnées jusqu'à
  ${hours(WEBHOOK_RETRY_SCHEDULE_SECONDS.at(-1))} (\`packages/core/src/webhooks.ts\`).
- Les observations d'exdate sont sous CC BY 4.0 ; les champs copiés de l'émetteur en sont exclus et
  nommés fichier par fichier (\`DATA-LICENSE.md\`).

## 10. Comment refaire les chiffres

\`\`\`bash
node scripts/rebuild-record.mjs        # le registre dérivé, dans l'ordre des dépendances
node scripts/check-data-expectations.mjs   # les attentes permanentes sur data/
node scripts/build-history.mjs --check     # l'index point-in-time contre git
\`\`\`
`

if (process.argv.includes('--check')) {
  const held = readFileSync(OUT, 'utf8')
  if (held !== note) {
    console.error('FAIL docs/methodology.md is not what the constants say.')
    console.error('     A constant moved in the code and the note did not, or the note was edited by hand.')
    console.error('     Run: node --experimental-strip-types scripts/build-methodology.mjs')
    process.exit(1)
  }
  console.error(`ok   docs/methodology.md matches the code (version m-${fingerprint})`)
} else {
  writeFileSync(OUT, note)
  console.error(`# docs/methodology.md, version m-${fingerprint}, ${Object.keys(CONSTANTS).length} constants read from the code`)
}
