# Audit d'intégrité des données publiées — 5 septembre 2026

Brief : `docs/data-audit-prompt.md`. Preuves : `docs/audit/2026-09-05-data/`. Audité : la branche
`claude/lance-en5q6j` à `96db252` (record) et `8d159c1` (origin, au moment de la clôture), le site
`www.exdate.me`, l'API `api.exdate.me`, la liste de jetons `/tokenlist.json`, `/calendar.ics`,
`/feed.xml`. Règles du brief appliquées : aucune donnée committée n'a été modifiée ; chaque
collecteur a été rejoué dans un clone propre ; les points d'accès utilisés sont publics et sans
clé ; chaque verdict est reproductible avec les commandes citées.

## 6.1 Résumé exécutif

1. **Exacts** : les deux décotes publiées se recalculent à la main depuis les entrées committées —
   AAPL 3 601 pb (3 601,81 exact ; le fichier tronque, l'API aussi), SGOV 3 378 pb — et les
   35 pas de multiplicateur à la tête de chaîne concordent sur deux points d'accès indépendants.
2. **Un chiffre publié est faux (S0)** : la page UPS, son badge, la liste de jetons et le
   calendrier disent qu'un dividende de 1,64 $ est « dû et pas encore sur la chaîne » alors que le
   pas a eu lieu le 4 septembre à 15:10:26 UTC (multiplicateur 1,002208724969205741, journal
   `0xc3a0a692…`, bloc 54 355 503, lu sur deux points d'accès). Le scan complet de la chaîne
   n'est pas un collecteur : personne ne l'a relancé depuis le 2 septembre.
3. **Traçables** : 92 affirmations relevées, 92 tracées à un champ d'un fichier committé et à
   son script ; aucune valeur sans source. Trois fichiers servis ne portent pas d'horodatage.
4. **Reproductibles** : le registre généré se régénère à l'octet près ; la liste de jetons ne se
   régénère pas à l'identique (DELL a perdu sa corroboration entre deux reconstructions).
5. **Incomplets, non déclarés (S3)** : deux dividendes déclarés depuis le 3 septembre (VRT, AVGO)
   manquent au grand livre du site, au calendrier et au flux, parce que les rapprochements sont
   construits sur l'instantané d'un mois que rien ne rafraîchit, et non sur l'archive.
6. **Formulés correctement** : 82 affirmations sur 92 tiennent mot pour mot ; les 10 autres sont
   les surfaces touchées par les deux points ci-dessus. Aucune date ex-dividende, aucun taux
   annualisé, aucun « vérifié » hors des cas où une lecture sur chaîne l'établit.
7. Comptes par sévérité : **S0 : 1, S1 : 0, S2 : 3, S3 : 2, S4 : 6** (tableau 6.4).
8. Le témoin d'archive pour la confirmation d'état des 12 pas est **unique aujourd'hui**
   (blockmachine) : ordofi et blxrbdn répondent « missing trie node » aux hauteurs des pas, alors
   que `rpc-endpoints.observed.json` (4 sept.) en nomme encore deux.
9. La phrase qu'un journaliste peut citer : « D'après le registre public de l'émetteur et l'état
   de Robinhood Chain, 36 % du dernier dividende Apple déclaré (0,27 $ par action, 13 août 2026)
   ne s'est pas retrouvé dans la valeur du jeton AAPL — un calcul que n'importe qui peut refaire
   à partir des mêmes sources : 3 601 points de base, au prix Chainlink de 305,17105 $ en vigueur
   à 15:12:46 UTC le 14 août. »
10. Ce qui reste sur un seul témoin, non rejoué ou hors de portée est en 6.9 ; le contrôle
    permanent (6.8) échoue aujourd'hui sur exactement les points 2 et 5, et sur la dérive de la
    liste de jetons.

## 6.2 Tableau de bord par jeu de données

Notes de 1 à 5 ; chaque note nomme la mesure qui la justifie. Colonnes : exactitude (Ex),
complétude (Co), cohérence (Ch), fraîcheur (Fr), unicité (Un), validité (Va), traçabilité (Tr),
reproductibilité (Re).

| Jeu | Ex | Co | Ch | Fr | Un | Va | Tr | Re | Mesure |
|---|---|---|---|---|---|---|---|---|---|
| `robinhood-assets.snapshot.json` | 5 | 5 | 4 | 2 | 5 | 5 | 5 | 5 | refetch : 194 = 194, 0 symbole/ISIN/statut changé, 194 ISIN valides ; 2 multiplicateurs périmés (UPS, F) après 3 jours ; `fetchedAt` présent |
| `robinhood-corporate-actions.snapshot.json` | 4 | 3 | 3 | 1 | 5 | 5 | 3 | 5 | 43 = 43 lignes mais 2 entrées / 2 sorties depuis ; aucun collecteur ne le rafraîchit ; pas d'horodatage ni de source dans le fichier |
| `corporate-actions.archive.json` | 5 | 5 | 5 | 4 | 5 | 5 | 5 | 5 | 45 lignes, clés (id, processDate) uniques, 43/43 lignes vives présentes, JBL passé COMPLETED depuis 06:38 (13 h) |
| `chainlink-feeds.snapshot.json` | 5 | 5 | 5 | 3 | 5 | 5 | 3 | 5 | 57 = 57, 0 champ changé ; tableau nu sans horodatage ni source |
| `multiplier-events.observed.json` | 5 | **2** | 5 | **1** | 5 | 5 | 5 | 5 | 13/13 journaux confirmés sur 2 points d'accès ; **UPS manquant** ; scan arrêté au bloc 52 672 800 (2 sept.) ; rescan : 14 journaux, 11 jetons |
| `multiplier-state-verification.json` | 5 | 4 | 5 | 3 | 5 | 5 | 5 | 3 | 12/12 transitions relues (blockmachine) ; UPS absent ; **un seul témoin d'archive** aujourd'hui |
| `effective-blocks.json` | 5 | 4 | 5 | 3 | 5 | 5 | 5 | 5 | 12/12 : bloc précédent = effectiveAt − 1 s, bloc d'effet = effectiveAt ; UPS absent |
| `effective-prices.observed.json` | 5 | 5 | 5 | 5 | 5 | 5 | 4 | 5 | 4 pas, 4 abandonnés avec motif ; UPS 6 cotations, la plus proche à 350 s ; battement du watcher à 19:41 (à l'heure) ; cotations sans marqueur `source` |
| `reconciliations.observed.json` | 5 | **3** | 3 | **2** | 5 | 5 | 4 | 5 | 2 décotes recalculées ; VRT/AVGO absents ; corroboration DELL/ASML périmée ; pas d'horodatage ; `price.value` à 4 décimales |
| `session-share.observed.json` | 5 | 4 | 5 | 5 | 5 | 5 | 5 | 5 | 61 échantillons, 60/168 créneaux, classifieur d'accord 61/61, part recalculée 0,7433 |
| `primary-flows.observed.json` | 5 | 4 | 5 | 4 | 5 | 5 | 5 | 5 | 2 fenêtres contiguës, net = émis − brûlé ; 14,8 h |
| `dex-feed-gap.observed.json` | 5 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | médianes recalculées (46,88 pb ; 83 907 s ; max 248,39), 26 flux = 26 flux du plan |
| `transfer-volume.observed.json` | 4 | 3 | 5 | 2 | 5 | 5 | 5 | 3 | mesure du 2 sept. ; non rejouée (fenêtre passée) |
| `capture-cadence.observed.json` | 5 | 5 | 5 | 4 | 5 | 5 | 5 | 4 | 132 exécutions, observé 06:48 ; lu, non rejoué (journal GitHub) |
| `rpc-endpoints.observed.json` | **3** | 5 | 4 | **2** | 5 | 5 | 5 | 5 | dit 2 points d'accès à l'ancien pas ; mesuré aujourd'hui : 1 ; le fichier prévient lui-même que l'ensemble bouge |
| `token-feed-map.json` | 5 | 5 | 4 | 5 | 5 | 5 | 5 | 5 | 35 paires, 35 proxys dans l'annuaire, comptes 20/1/20 recalculés ; `verified: false` partout |
| `feed-map-verification.json` | 5 | 4 | 5 | 3 | 5 | 5 | 5 | **2** | 35/35 descriptions ; la commande documentée réécrit `crossChecks: []` |
| `svr-proxy-check.json` | 5 | 5 | 5 | 3 | 5 | 5 | 5 | 5 | 35/35 même agrégateur, même réponse, 0 même roundId ; rejoué à l'identique |
| `issuer-quote-basis.json` | 5 | 5 | 5 | 4 | 5 | 5 | 5 | 5 | rejoué : même verdict (SGOV décisif) |
| `dex-pools.json` | 4 | 5 | 5 | 4 | 5 | 5 | 5 | 4 | 277 bassins, 105 liquides, 65 cotables ; non rejoué (découverte) |
| `exdate.tokenlist.json` | 4 | 5 | **3** | 3 | 5 | 5 | 4 | **2** | schéma tenu, 194 adresses en somme de contrôle ; DELL dérive ; UPS à 1 ; non reconstruit à l'identique |
| `base-b20-verification.json` | 5 | 5 | 5 | 3 | 5 | 5 | 5 | 4 | 13 jetons ; lu, non rejoué |
| `base-coinbase-feeds.snapshot.json` | 5 | 5 | 5 | 3 | 5 | 5 | 5 | 4 | 13 flux ; lu, non rejoué |

## 6.3 Registre des affirmations (P0)

92 affirmations, dans `docs/audit/2026-09-05-data/claim-register.csv`, reproduites en annexe A
avec les quatre verdicts (traçabilité, reproduction, témoins, formulation). Échantillonnage :
la page d'accueil, `/dividends/`, `/market/`, `/about/`, une page de jeton par état (jamais bougé,
bougé sans déclaration, prochain déclaré, mesuré, dû), leurs badges et images de lien, la liste de
jetons, le calendrier et le flux, plus la page UPS ajoutée par l'audit.

## 6.4 Tableau des constats

| id | Sév. | Dimension | Surfaces | Affirmation | Champ | Preuve | Cause | Correctif | Effort | Publics |
|---|---|---|---|---|---|---|---|---|---|---|
| F01 | **S0** | exactitude, complétude | `/t/0xf232…9ce2/`, `/badge/…`, image de lien, `/tokenlist.json`, `/calendar.ics`, `/feed.xml`, `/dividends/` (12 « posés »), `data/` | « One dividend is owed and not yet on chain: declared for 3 September 2026, $1.6400 per token » ; parts par jeton « 1 » | `multiplier-events.observed.json` (scan jusqu'au bloc 52 672 800), puis `effective-blocks`, `multiplier-state-verification`, `reconciliations`, `exdate.tokenlist` | `witnesses-2.json` : `uiMultiplier()` = 1002208724969205741 sur blockmachine et Robinhood ; `collectors.log` : rescan → « 14 events across 11 tokens » ; `collectors-rerun.diff` : journal `0xc3a0a692…`, bloc 54 355 503, effet 2026-09-04T15:10:26Z ; `cross-surface.json` `multiplierEvents.onlyApi` (source `onchain:sweep`), `upsPending.nothingPending = true` ; `first-party-refetch.json` : registre émetteur UPS 1,002208… | le scan de toute la chaîne est une commande manuelle, pas un collecteur ; le watcher et l'indexeur voient le journal en direct mais rien ne le réécrit dans `data/` | rejouer la chaîne : `backfill-multiplier-events` → `resolve-effective-blocks` → `verify-multiplier-history` → `build-reconciliations` → `generate-registry` → `build-token-list` ; en faire un collecteur quotidien, ou le déclencher quand le watcher enregistre un pas ; le contrôle 6.8 échoue déjà dessus | S | détenteurs, curateurs, agrégateurs, presse |
| F02 | S3 | complétude | `/dividends/` (« 37 declared »), `/calendar.ics`, `/feed.xml`, `/t/…VRT/`, `/t/…AVGO/`, `data/reconciliations.observed.json` | 37 dividendes déclarés et pas sur la chaîne | `reconciliations.observed.json` `builtFrom.corporateActions = robinhood-corporate-actions.snapshot.json` (43 lignes, 2 sept.) | `cross-surface.json` `declaredDividends.archiveNotInReconciliationFile` : VRT 24/09 (vu le 3 sept.), AVGO 30/09 (vu le 4) ; l'API en sert 38 ; `first-party-refetch.json` : ASML 05/08 et BND 05/08 sont déjà sortis de la fenêtre vive | le script lit l'instantané d'un mois que rien ne rafraîchit, pas l'archive ; rafraîchir l'instantané ferait passer ASML d'« anomalie » à « sans déclaration » | construire sur `corporate-actions.archive.json` ; reconstruire dans le job d'archive quotidien | S | détenteurs, curateurs |
| F03 | S2 | cohérence | `/tokenlist.json`, API `/v1/4663/tokens`, `/v1/4663/reconciliations`, `data/reconciliations.observed.json` | corroboration du couple jeton → flux (« price », « ticker only ») | `token-feed-map.json` `pairs[].corroboratedBy` (18:30) contre `exdate.tokenlist.json` (06:38), `reconciliations` (4 sept. 08:47) et le registre compilé dans l'API (déploiement du 4 sept.) | `cross-surface.json` `feedCorroboration.disagreements` : 6 couples sur 35 — DELL (plan : aucune ; liste, API, rapprochements : prix), ASML (rapprochements : prix), CRCL/SNDK/USO (API : prix ; plan : aucune), PLTR (plan : prix ; API : aucune) ; DELL 23/38 et ASML 24/38 lectures, sous les deux tiers | une majorité sans hystérésis, recalculée chaque heure, et quatre reconstructions sur quatre calendriers ; l'API lit `findToken()` dans le registre généré compilé à l'image | reconstruire liste et rapprochements dans le job horaire après le plan (node nu, sans install) ; publier le compte (« 23 of 38 ») à côté du verdict ; faire lire à l'API le registre au démarrage depuis le fichier, ou la redéployer quand il change | M | agrégateurs, portefeuilles, consommateurs de l'API |
| F04 | S2 | traçabilité (témoins) | `data/multiplier-state-verification.json`, `data/rpc-endpoints.observed.json`, `/about/` (couverture) | 12/12 transitions confirmées dans l'état de la chaîne ; « deux points d'accès atteignent l'ancien pas » | `multiplier-state-verification.json` `archiveEndpoint`, `rpc-endpoints.observed.json` `summary.reachingOldestStep = 2` | `witnesses-2.json` : blockmachine 12/12, ordofi 0/12, blxrbdn 0/12 (« missing trie node ») ; `collectors.log` : ordofi 0/12 illisibles ; le fichier des points d'accès date du 4 sept. 22:30 | l'ensemble des points d'accès tiers change sans préavis, ce que le fichier dit lui-même ; la sonde n'est pas planifiée | sonde quotidienne ; vérification d'état qui essaie chaque point d'accès atteignant le pas et enregistre les témoins par pas | S | curateurs, réutilisateurs |
| F05 | S2 | reproductibilité | `data/feed-map-verification.json`, `CLAUDE.md` (« uniquely closest of all 35 feeds ») | contrôle négatif : le flux assigné est le plus proche parmi 35 | `crossChecks[]` | `collectors-rerun.diff` : −122 lignes ; `verify-feed-map.mjs` l.246 : le bloc n'est calculé qu'avec `--cross-check`, non documenté | la commande documentée réécrit le fichier avec `crossChecks: []` | calcul par défaut, ou refus d'écraser un bloc non vide ; documenter l'option | S | réutilisateurs |
| F06 | S3 | provenance, licence | `data/reconciliations.observed.json`, `/tokenlist.json`, `data/effective-prices.observed.json`, `DATA-LICENSE.md` | « chaque valeur copiée de l'émetteur porte un `source` commençant par `robinhood:` » | lignes des rapprochements (0/49 avec `source`, 43 avec un `rate` de l'émetteur), extensions de la liste (ISIN, nom, `dividendOwedPerToken`), cotations capturées | mesure directe (section P10 du journal) ; le texte d'attribution à reporter n'est pas énoncé | la clause décrit les fichiers par-ligne (archive, registre) et pas les fichiers dérivés qui sont servis | `source` par ligne ou bloc `sources` par fichier nommant les champs de l'émetteur ; une ligne d'attribution dans `DATA-LICENSE.md` | S | réutilisateurs, presse |
| F07 | S4 | validité (qualificatifs) | `data/` | horodatage et méthode dans chaque fichier servi | `chainlink-feeds.snapshot.json` (tableau nu), `robinhood-corporate-actions.snapshot.json` (`{corpActions}`), `reconciliations.observed.json` | listing P7 du journal : 3 fichiers sans horodatage, 5 sans source/méthode | fichiers de phase 0 jamais enveloppés | envelopper `{fetchedAt, source, rows}` ; `builtAt` dans les rapprochements | S | réutilisateurs |
| F08 | S4 | validité (arrondi) | `data/reconciliations.observed.json`, `docs/api.md` | prix « 305.1711 », décote 3 601 pb | `price.value` (4 décimales) ; l'API sert « 305.17105 » ; convention de troncature non écrite | recalcul : 3 601,81 → 3 601 (troncature) / 3 602 (arrondi) ; SGOV 3 378,13 → 3 378 | affichage arrondi stocké à la place de la valeur brute | stocker la réponse brute (8 décimales) et écrire la convention | S | réutilisateurs |
| F09 | S4 | cohérence (sémantique API) | API `/v1/4663/reconciliations`, SDK | `confidence` et `feedCorroboratedBy` | 46 lignes « low » sans rapprochement ; `[]` sur les lignes sans prix alors que le couple est corroboré (SGOV ×2, MU, DELL, ASML, MSFT, GOOGL, NVDA) | `cross-surface.json` `reconciliations.sameRowDiffers` | le sérialiseur ne porte l'évidence que sur les lignes priçées, contre le type de core (« a fact about the pairing, not about this row ») | porter le couple sur toute ligne avec un flux, ou le documenter | S | consommateurs API/SDK |
| F10 | S4 | cohérence (documentation) | `CLAUDE.md`, brief §1.6 | « 12 sur 35 par ticker seul, 22 par le prix » | `token-feed-map.json` : 15 / 20 / 1 | `cross-surface.json`, `token-feed-map.json` (`corroboratedByPrice = 20`) | la note a figé un instant d'une mesure mobile | écrire « au dernier relevé » avec la date, ou lire le fichier | S | mainteneurs |
| F11 | S4 | fraîcheur (déploiement) | `/`, `/market/` | 74,1 % sur 60 échantillons ; écart max 235 pb (SNDK) | `session-share` (74,3 %, 61) ; `dex-feed-gap` (248,39 à 18:30) | lecture des pages en direct à 20:00 UTC ; le déploiement CLI de 18:52 a publié une copie locale en retard d'un commit sur origin | règle « un build collecteur par heure » (voulue) et déploiement depuis une copie locale | `git fetch` avant `deploy-web.sh` ; préférer le workflow | S | lecteurs |
| F12 | S4 | fraîcheur | `data/robinhood-assets.snapshot.json` | multiplicateur courant | UPS et F à 1,0 dans l'instantané du 2 sept. | `first-party-refetch.json` `assets.multiplierChanged` | pas rafraîchi par un collecteur ; aucun chiffre affiché n'en dépend | rafraîchir dans le job d'archive quotidien | S | mainteneurs |

Classement sévérité × portée × coût (5.3), avec avant/après pour les dix premiers :

1. **F01** — avant : « dû, pas sur la chaîne, 1,64 $ » ; après : « posé le 4 septembre 2026,
   +0,221 %, pas de flux de prix, cotation la plus proche à 350 s : non mesurable ».
2. **F02** — avant : 37 déclarés ; après : 39 (VRT 24/09, AVGO 30/09 ajoutés au grand livre, au
   calendrier et au flux).
3. **F03** — avant : DELL « price » dans la liste et l'API, « ticker only » sur le site ; après : une
   seule valeur par heure sur les quatre surfaces, avec « 23 of 38 readings » lisible.
4. **F06** — avant : carve-out invérifiable dans les fichiers servis ; après : champs de l'émetteur
   nommés dans chaque fichier, ligne d'attribution.
5. **F04** — avant : un témoin, un fichier qui en annonce deux ; après : sonde quotidienne, témoins
   par pas.
6. **F09** — avant : `feedCorroboratedBy: []` sur une ligne corroborée ; après : le couple sur toute
   ligne avec flux.
7. **F05** — avant : la commande documentée efface le contrôle négatif ; après : calcul par défaut.
8. **F11** — avant : copie locale déployée ; après : `git fetch` obligatoire.
9. **F08** — avant : « 305.1711 » ; après : « 305.17105 », convention écrite.
10. **F07** — avant : trois fichiers sans date ; après : enveloppe uniforme.

## 6.5 Matrices de couverture (P4)

Détail : `docs/audit/2026-09-05-data/coverage.json`.

| Dimension | Couverts | Sur | Déclaré où | Verdict |
|---|---|---|---|---|
| Jetons avec un flux Chainlink | 35 | 194 | `/about/`, page de jeton (« no », « nothing to price a step against »), liste (`priceFeed: null`) | déclaré |
| Couples flux corroborés par le prix / par le pas / ni l'un ni l'autre | 20 / 1 / 15 | 35 | `/market/` (« Pairing »), page de jeton | déclaré ; la note du dépôt dit 22 / 1 / 12 (F10) |
| Jetons cotables sur un bassin USDG liquide | 67 (26 avec flux) | 194 | `/market/` (« 41 of 67 with a liquid pool ») | déclaré |
| Pas de multiplicateur observés | 12 changements, 13 journaux, 10 jetons | 13 / 14 / 11 sur la chaîne | `/dividends/` (« 12 landed ») | **non déclaré** (F01) |
| Pas confirmés dans l'état de la chaîne | 12 | 12 (13) | `multiplier-state-verification.json` | un témoin (F04) |
| Pas avec une cotation de l'émetteur à l'instant | 0 | 4 dans la fenêtre de capture | `effective-prices.observed.json`, page de jeton (« no price feed ») | déclaré avec motif |
| Dividendes déclarés dans l'archive / au grand livre | 45 / 43 (37 en attente) | 45 | `/dividends/` | **non déclaré** (F02) |
| Jetons avec un dividende déclaré non posé | 35 | 194 | liste (`dividendDeclaredNotOnChain`) | déclaré |
| Créneaux horaires ET de la semaine échantillonnés | 60 | 168 | `/` (« 61 samples · 3–5 September ») | déclaré |
| Points d'accès RPC : découverts / répondent / atteignent l'ancien pas | 9 / 6 / 1 | 9 | `rpc-endpoints.observed.json` dit 2 | périmé (F04) |
| Actions de juillet sans taux déclaré | 5 | 5 | page de jeton (« nothing declared ») | déclaré (écart connu 1.6) |
| Base : jetons vérifiés / multiplicateurs ayant bougé | 13 / 0 | 13 | `/about/` | déclaré |

## 6.6 Journaux de reproduction et de témoins (P2, P3)

Tout est sous `docs/audit/2026-09-05-data/` :

- `collectors.log` — chaque collecteur rejoué dans un clone propre (`git clone` de la branche,
  `pnpm install`), sortie et code de retour : `generate-registry`, `snapshot-registry`,
  `archive-corporate-actions`, `build-token-list`, `resolve-effective-blocks`,
  `verify-multiplier-history` (blockmachine 12/12 ; ordofi 0/12), `check-svr-proxies`,
  `verify-feed-map`, `check-quote-basis`, `build-reconciliations`, `backfill-multiplier-events`
  (14 journaux), `generate-registry` à nouveau, puis `git status` / `git diff --stat`.
- `collectors-rerun.diff` — le diff complet (4 412 lignes) entre les fichiers committés et ce que
  les collecteurs écrivent aujourd'hui : le journal UPS, JBL passé COMPLETED, DELL et ASML sans
  corroboration, `crossChecks` vidé, les prix spot du jour.
- Régénération depuis les données committées, sans réseau : `generate-registry.mjs` produit un
  `registry.ts` **identique à l'octet** ; `build-token-list.mjs` produit une liste différente
  (DELL, version 1.0.4) — voir F03.
- `witnesses.mjs` / `witnesses.json`, `witnesses-2.mjs` / `witnesses-2.json` — lectures directes,
  sans le code du dépôt : 13/13 journaux `UIMultiplierUpdated` sur Robinhood et blockmachine ;
  `uiMultiplier()` des 194 jetons au bloc 55 379 946 sur blockmachine et blxrbdn, 194/194
  égaux ; état aux hauteurs des 12 pas : blockmachine 12/12, ordofi 0/12, blxrbdn 0/12 ; le round
  AAPL 18446744073709552078 relu sur l'agrégateur : 30517105000.
- `first-party-refetch.mjs` / `.json` — `/rhj/assets`, `/rhj/corporate-actions?limit=500` et
  l'annuaire Chainlink refaits à 19:55 UTC et diffés contre les instantanés.
- `cross-surface.mjs` / `.json` / `.log` — les mêmes faits sur `data/`, l'API hébergée et la liste.
- `coverage.json` — les matrices de 6.5, avec le contrôle des 194 ISIN.
- `audit-adversarial.test.ts` / `.log` — les 14 scénarios de P9, exécutés sous vitest dans
  `packages/core` puis retirés du paquet (14/14 tiennent).
- `expectations.log` — la sortie du contrôle permanent (6.8) sur le record du jour.
- Recalcul à la main (entrées committées, arithmétique entière) : AAPL `expectedStepWad` =
  884749716593366, `observedStepWad` = 566080061092436, reçu 0,172751, décote 3 601,81 pb ; SGOV
  (prix exact 100,57120681, multiplicateur en vigueur 1,000957519890990718) `observedStepWad` =
  2022063289954840, reçu 0,203167, décote 3 378,13 pb. Avance d'annonce : médiane 9,6 min, 11/12
  sous 10 min. Décalage après la date de l'émetteur : 1, 1, 3, 1, 3, 1 jours → médiane 1, 4 sur 6.
- Points d'accès utilisés : `https://rpc.mainnet.chain.robinhood.com`,
  `https://rpc-robinhood.blockmachine.io`, `https://rpc.ordofi.network`,
  `https://robinhood.rpc.blxrbdn.com`, `https://api.robinhood.com/rhj/`,
  `https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json`,
  `https://api.exdate.me`, `https://www.exdate.me`. Aucun refus de débit rencontré (lectures RPC
  par lots de 20, 3 appels à l'API de l'émetteur).

Vérifié, tient (contrôle nommé) : fraîcheur des flux étiquetée par l'API (24/35 `stale`,
`beyondHeartbeat: true`, âge médian 87 201 s, jamais `null` sur un jeton à flux) ; règle du
`null` sur 4 routes de liste et sur `yield`/`pending` pour 5 jetons (aucune clé absente quand le
parent existe ; les zéros sont des comptes) ; codes de refus énumérés (`no_observed_schedule`,
`window_shorter_than_period`, `delivery_not_demonstrated`, `insufficient_reconciliations`,
`announcement_lead_is_minutes`, `haircut_not_forecastable`, `withholding_undocumented`,
`no_observed_distribution`) ; `calendar.ics` en CRLF, lignes ≤ 75 octets, 49 UID uniques, un
`DTSTART` par événement ; les figures de la page d'accueil égales à leur champ (36 %, +2 685 113) ;
`/data/` ne sert pas les trois fichiers de l'émetteur (404, liens vers le dépôt) ; « not
affiliated » sur chaque page ; « tokenized stock » uniquement dans la formulation de Base.

## 6.7 Verdicts de formulation (P6)

Une ligne par affirmation en annexe A (colonne `wording`). Résumé : 82 « holds » ; 6 S0 (les
quatre surfaces UPS et les deux comptes « 12 landed ») ; 4 S3 (« 37 declared » sur deux pages, le
calendrier et le flux). Contrôles transversaux : aucune occurrence de « ex-date », « pay date »,
« yield » annualisé ; « never arrived » et un pourcentage n'apparaissent que sur les lignes
`matched` ; une anomalie lit « doesn't add up », un jeton sans flux « no price feed », jamais un
nombre ; « verified » n'est employé que pour la lecture sur chaîne de Base et dans la
documentation du champ API ; chaque statistique porte n et sa date ; « corroborated by its
step » n'est dit que de SGOV.

## 6.8 Le fichier d'attentes et le job CI (P11)

Prêts à committer, dans ce commit : `scripts/check-data-expectations.mjs` (97 contrôles, node
nu ; viem est chargé depuis `packages/core` pour la somme de contrôle EIP-55 et le contrôle est
« skip » sans lui, jamais « ok ») et `.github/workflows/data-expectations.yml` (sur chaque commit
touchant `data/`, et à la demande). Couvert : comptes de lignes et unicité des clés par jeu ;
adresses en somme de contrôle et présentes dans le registre ; ISIN ; dates monotones et dans la
cadence (×3) ; invariants WAD (`newMultiplier > oldMultiplier`, `stepBps` recalculé, reçu ≤
déclaré, décote ∈ [0, 10 000] recalculée à ±1 pb, anomalie hors bande) ; jointures (chaque pas
dans `effective-blocks` et `multiplier-state-verification`, chaque pas capturé dans les
événements, chaque flux du plan dans l'annuaire, chaque ligne d'archive vive au grand livre,
liste = plan) ; part hors séance recalculée et classifieur d'accord sur chaque échantillon ; flux
contigus et net = émis − brûlé ; médianes de l'écart recalculées ; ICS et figures de la page
d'accueil quand `apps/web/out` existe.

Sur le record du jour : **4 échecs, 4 avertissements** — UPS absent des événements (F01), VRT et
AVGO absents du grand livre (F02), DELL dans la liste (F03), et la part hors séance de la page
construite localement (59 échantillons) contre le fichier (61), qui est l'avertissement F11 et
non un défaut du record. Les avertissements sont les trois fichiers sans horodatage (F07) et
l'entrée « instantané » des rapprochements (F02).

## 6.9 Ce qui n'a pas été vérifié, et pourquoi

- **La confirmation d'état des 12 pas repose sur un témoin** : seul blockmachine sert l'état aux
  hauteurs des pas aujourd'hui ; ordofi et blxrbdn répondent « missing trie node ». Un second
  témoin existait le 4 septembre ; il n'existe plus.
- **La base de cotation de `/rhj/prices`** ne peut pas être revérifiée à un instant passé (le
  point d'accès ne sert que le présent) ; le script a été rejoué aujourd'hui et donne le même
  verdict (SGOV décisif, 1,0 pb contre 51,7), ce qui est une nouvelle mesure et non la
  reproduction de l'ancienne.
- **`crossChecks`** (contrôle négatif du plan) : non rejoué, l'option n'étant pas documentée et
  son exécution réécrivant le fichier ; le bloc du 2 septembre est la seule évidence.
- **Le code que fait tourner `api.exdate.me`** n'est pas lisible de l'extérieur (pas de point
  d'accès de version) ; la révision est inférée du comportement (registre compilé du 4 sept.).
- **La page `/wallet/`** (lecture en direct dans le navigateur) n'a pas été exercée : elle
  demande un navigateur et une adresse ; hors du registre échantillonné.
- **Base** (13 jetons, registre d'oracle) : lu, non rejoué sur chaîne.
- **Les conditions de Chainlink** restent non lues (rendu JavaScript), comme le dit
  `docs/terms-review.md`.
- **L'explorateur** (Cloudflare) n'a pas servi de témoin.
- **Les calendriers par jeton** (`/t/<adresse>/calendar.ics`) et les images de lien n'ont été
  contrôlés que sur le texte, pas un par un.
- **La cadence GitHub** (`capture-cadence`) et le volume de transferts du 2 septembre sont lus,
  pas rejoués : leurs fenêtres sont passées.
- **Les cinq actions de juillet** sont irrécupérables (écart connu 1.6) ; vérifié qu'il est dit
  sur chaque page concernée.
- Aucune limite de débit atteinte ; aucun refus enregistré.

## 6.10 Feuille de route

**Cette semaine (S0, S1)** — F01 : rejouer la chaîne des six scripts et committer ; faire du
rescan un collecteur (quotidien, ou déclenché par le watcher au premier pas enregistré). F02 :
construire les rapprochements sur l'archive et les reconstruire dans le job d'archive.
Activer `data-expectations.yml` ; il passera au vert avec ces deux correctifs et la reconstruction
de la liste.

**Ce mois (S2, S3)** — F03 : une seule chaîne de reconstruction (plan → liste → rapprochements →
registre) dans le job horaire ; l'API relit le registre depuis le fichier au démarrage ou est
redéployée à chaque changement ; publier la majorité (« 23 of 38 ») avec le verdict. F04 : sonde
quotidienne des points d'accès ; vérification d'état multi-témoins par pas. F05 : contrôle
négatif par défaut. F06 : champs de l'émetteur nommés dans chaque fichier servi, ligne
d'attribution dans `DATA-LICENSE.md`.

**Ce trimestre (S4, contrôles permanents)** — F07–F12 ; intégrer `audit-adversarial.test.ts`
dans `packages/core/test` ; enchaîner le contrôle des figures du site au job de déploiement, qui
construit `apps/web/out` ; ajouter au contrôle permanent une lecture à la tête de chaîne de
`uiMultiplier()` sur les 194 jetons contre le registre généré, pour qu'un pas non scanné soit
détecté sans dépendre du watcher.

---

## Annexe A — Registre des affirmations avec verdicts

Colonnes du brief (6.3). `dataset.field`, script et appel source sont dans le CSV ; ici : surface, texte, valeur, date affichée, et les quatre verdicts.

| id | surface | texte | valeur | date affichée | traçabilité | reproduction | témoins | formulation |
|---|---|---|---|---|---|---|---|---|
| C001 | / | measured: of Apple’s last dividend never arrived | 36% | 14 Aug 2026 · priced at the instant of the step | traced | reproduced by hand: 3601.81 bps -> 3601 (floor) / 3602 (round); received 0.172751 | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; Chainlink directory refetched 2026-09-05T19:55Z; round read from the aggregator | holds; S4 price stored at 4 dp (F08) |
| C002 | / | measured: of transfers outside US market hours | 74.3% | 59 samples · 3–5 September 2026 · the figure to check was 46% | traced; the live page shows the previous hour (74.1 %, 60 samples) - F11 | recomputed 0.7433 from the 61 samples, hour-weighted; classifier agrees on 61/61 | single collector; chain reads not re-run (windows are past) | holds; sample and dates stated |
| C003 | / | measured: tokens created net, 23 h | +2,685,113 | 188 tokens · to 5 Sept 2026 | traced | recomputed: minted - burned = net; windows contiguous | single collector run; not re-read from chain | holds |
| C004 | / | dividend row: Apple   AAPL | 13 Aug 2026 \| $0.27 \| $0.17 \| 36 % |  | traced | reproduced by hand: 3601.81 bps -> 3601 (floor) / 3602 (round); received 0.172751 | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; Chainlink directory refetched 2026-09-05T19:55Z; round read from the aggregator | holds; S4 price stored at 4 dp (F08) |
| C005 | / | dividend row: iShares 0-3 Month Treasury Bond   SGOV | 6 Aug 2026 \| $0.31 \| $0.20 \| 34 % |  | traced | reproduced by hand: 3378.13 bps -> 3378; received 0.203167 | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; Chainlink directory refetched 2026-09-05T19:55Z; round read from the aggregator | holds |
| C006 | / | dividend row: Ford Motor   F | 1 Sept 2026 \| $0.15 \| — \| no price feed |  | traced | reproduced: no feed, no quote at effect -> anomaly | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; capture record (effective-prices) | holds ('no price feed', no figure) |
| C007 | / | dividend row: Carnival Corporation   CCL | 28 Aug 2026 \| $0.15 \| — \| no price feed |  | traced | reproduced: no feed, no quote at effect -> anomaly | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; capture record (effective-prices) | holds ('no price feed', no figure) |
| C008 | / | dividend row: Costco   COST | 7 Aug 2026 \| $1.47 \| — \| no price feed |  | traced | reproduced: no feed, no quote at effect -> anomaly | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; capture record (effective-prices) | holds ('no price feed', no figure) |
| C009 | / | dividend row: ASML Holding NV   ASML | 5 Aug 2026 \| $1.82 \| $0.17 \| doesn’t add up |  | traced | reproduced: 9037 bps, outside [-100, 5000] -> anomaly | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | holds ('doesn't add up', no figure shown) |
| C010 | / | ring figcaption | 36 %  of  Apple ’s last dividend never arrived on chain. Declared $ 0.27  · Arrived $ 0.17  ·  14 August 2026 |  | traced | reproduced by hand: 3601.81 bps -> 3601 (floor) / 3602 (round); received 0.172751 | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; Chainlink directory refetched 2026-09-05T19:55Z; round read from the aggregator | holds; S4 price stored at 4 dp (F08) |
| C011 | /dividends/ | stat: declared, not on chain | 37 | 35 tokens | traced; INCOMPLETE: VRT 09-24 and AVGO 09-30 absent (F02); API says 38 | recounted 37 from the file | issuer API refetched 2026-09-05T19:55Z | S3: undercount not declared (F02) |
| C012 | /dividends/ | stat: the issuer calls paid | 7 | oldest 31 days | traced | recounted 7 | issuer API refetched 2026-09-05T19:55Z | holds |
| C013 | /dividends/ | stat: landed on chain | 12 | since 2 Jul 2026 | traced; INCOMPLETE: UPS 2026-09-04 missing (F01) | rescan in a clean clone finds 14 logs / 13 changes | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | S0: 13 landed, page says 12 (F01) |
| C014 | /dividends/ | stat: measured cleanly | 2 | 10 cannot be | traced | recounted 2 / 10 | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | holds |
| C015 | /dividends/ | stat: warning before a change | ~10 min | 11 of 12 within 10 min | traced | recomputed: median 9.6 min, 11 of 12 within 10 min | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | holds |
| C016 | /dividends/ | stat: after the issuer’s date | 1 day | 6 datable cases | traced | recomputed: lags 1,1,3,1,3,1 -> median 1 day, 4 of 6 at 1 day | issuer API refetched 2026-09-05T19:55Z | holds |
| C017 | /dividends/ | coming rows | 37 |  | traced; INCOMPLETE: VRT 09-24 and AVGO 09-30 absent (F02); API says 38 | recounted 37 from the file | issuer API refetched 2026-09-05T19:55Z | S3: undercount not declared (F02) |
| C018 | /dividends/ | landed rows | 12 |  | traced; INCOMPLETE: UPS 2026-09-04 missing (F01) | rescan in a clean clone finds 14 logs / 13 changes | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | S0: 13 landed, page says 12 (F01) |
| C019 | /dividends/ | landed row: Ford Motor   F | 2 Sept 2026 +0.015% \| $0.1500 \| — \| no price feed |  | traced | reproduced: no feed, no quote at effect -> anomaly | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; capture record (effective-prices) | holds ('no price feed', no figure) |
| C020 | /dividends/ | landed row: iShares 0-3 Month Treasury Bond   SGOV | 1 Sept 2026 +0.211% \| — \| — \| nothing declared |  | traced | reproduced: no issuer row inside the 4-day window | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | holds ('nothing declared'; July loss is known gap 1.6) |
| C021 | /dividends/ | landed row: Carnival Corporation   CCL | 31 Aug 2026 +2.149% \| $0.1500 \| — \| no price feed |  | traced | reproduced: no feed, no quote at effect -> anomaly | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; capture record (effective-prices) | holds ('no price feed', no figure) |
| C022 | /dividends/ | landed row: Apple   AAPL | 14 Aug 2026 +0.057% \| $0.2700 \| $0.1728 \| 36 % |  | traced | reproduced by hand: 3601.81 bps -> 3601 (floor) / 3602 (round); received 0.172751 | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; Chainlink directory refetched 2026-09-05T19:55Z; round read from the aggregator | holds; S4 price stored at 4 dp (F08) |
| C023 | /dividends/ | landed row: Costco   COST | 10 Aug 2026 +0.061% \| $1.4700 \| — \| no price feed |  | traced | reproduced: no feed, no quote at effect -> anomaly | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; capture record (effective-prices) | holds ('no price feed', no figure) |
| C024 | /dividends/ | landed row: iShares 0-3 Month Treasury Bond   SGOV | 7 Aug 2026 +0.202% \| $0.3068 \| $0.2032 \| 34 % |  | traced | reproduced by hand: 3378.13 bps -> 3378; received 0.203167 | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; Chainlink directory refetched 2026-09-05T19:55Z; round read from the aggregator | holds |
| C025 | /dividends/ | landed row: ASML Holding NV   ASML | 6 Aug 2026 +0.010% \| $1.8171 \| $0.1749 \| doesn’t add up |  | traced | reproduced: 9037 bps, outside [-100, 5000] -> anomaly | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | holds ('doesn't add up', no figure shown) |
| C026 | /dividends/ | landed row: Dell   DELL | 3 Aug 2026 +0.006% \| — \| — \| nothing declared |  | traced | reproduced: no issuer row inside the 4-day window | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | holds ('nothing declared'; July loss is known gap 1.6) |
| C027 | /dividends/ | landed row: Oracle   ORCL | 27 Jul 2026 +0.221% \| — \| — \| nothing declared |  | traced | reproduced: no issuer row inside the 4-day window | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | holds ('nothing declared'; July loss is known gap 1.6) |
| C028 | /dividends/ | landed row: Micron Technology   MU | 24 Jul 2026 +0.007% \| — \| — \| nothing declared |  | traced | reproduced: no issuer row inside the 4-day window | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | holds ('nothing declared'; July loss is known gap 1.6) |
| C029 | /dividends/ | landed row: iShares 0-3 Month Treasury Bond   SGOV | 8 Jul 2026 +0.096% \| — \| — \| nothing declared |  | traced | reproduced: no issuer row inside the 4-day window | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | holds ('nothing declared'; July loss is known gap 1.6) |
| C030 | /dividends/ | landed row: CrowdStrike Holdings   CRWD | 2 Jul 2026 ×4 split \| — \| — \| nothing declared |  | traced | reproduced: no issuer row inside the 4-day window | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | holds ('nothing declared'; July loss is known gap 1.6) |
| C031 | /market/ | stat: median gap, traded vs oracle | 46 bps | 26 tokens | traced to the 17:26 reading; record moved to 18:30 (F11) | summary medians recomputed from rows: 46.88 bps, 248.39 max, 83907 s | single instant read; not re-read | holds; date and n stated |
| C032 | /market/ | stat: widest gap | 235 bps | SNDK · pool $52,132 | traced to the 17:26 reading; record moved to 18:30 (F11) | summary medians recomputed from rows: 46.88 bps, 248.39 max, 83907 s | single instant read; not re-read | holds; date and n stated |
| C033 | /market/ | stat: median oracle age | 22 h 15 min | 7 past the 24 h heartbeat | traced to the 17:26 reading; record moved to 18:30 (F11) | summary medians recomputed from rows: 46.88 bps, 248.39 max, 83907 s | single instant read; not re-read | holds; date and n stated |
| C034 | /market/ | stat: tokens trade with no oracle | 41 | of 67 with a liquid pool | traced to the 17:26 reading; record moved to 18:30 (F11) | summary medians recomputed from rows: 46.88 bps, 248.39 max, 83907 s | single instant read; not re-read | holds; date and n stated |
| C035 | /market/ | stat: tokens created net | +2,685,113 | 23 h to 5 Sept 2026 | traced | recomputed: minted - burned = net; windows contiguous | single collector run; not re-read from chain | holds |
| C036 | /market/ | stat: creations | 3203 | 188 tokens moved | traced | recomputed: minted - burned = net; windows contiguous | single collector run; not re-read from chain | holds |
| C037 | /market/ | stat: redemptions | 513 | contiguous with the last window | traced | recomputed: minted - burned = net; windows contiguous | single collector run; not re-read from chain | holds |
| C038 | /market/ | gap rows | 26 |  | traced to the 17:26 reading; record moved to 18:30 (F11) | summary medians recomputed from rows: 46.88 bps, 248.39 max, 83907 s | single instant read; not re-read | holds; date and n stated |
| C039 | /market/ | session rows | 5 |  | traced to the 17:26 reading; record moved to 18:30 (F11) | summary medians recomputed from rows: 46.88 bps, 248.39 max, 83907 s | single instant read; not re-read | holds; date and n stated |
| C040 | /t/0xa5d4968421ba94814be3b136b15cf422101ac1a3/ [none, 150 tokens] | answer | No dividend has been declared for this token, and its multiplier has never moved. |  | traced | reproduced from the files | chain: multiplier 1.0 at head on 2 endpoints | holds |
| C041 | /t/0xa5d4968421ba94814be3b136b15cf422101ac1a3/ [none] | stat: shares per token today | 1 | unchanged since launch | traced | reproduced from the files | chain: multiplier 1.0 at head on 2 endpoints | holds |
| C042 | /t/0xa5d4968421ba94814be3b136b15cf422101ac1a3/ [none] | stat: owed | — | nothing declared and unpaid | traced | reproduced from the files | chain: multiplier 1.0 at head on 2 endpoints | holds |
| C043 | /t/0xa5d4968421ba94814be3b136b15cf422101ac1a3/ [none] | stat: no dividend measured yet | — |  | traced | reproduced from the files | chain: multiplier 1.0 at head on 2 endpoints | holds |
| C044 | /t/0xa5d4968421ba94814be3b136b15cf422101ac1a3/ [none] | stat: Chainlink price feed | no | nothing to price a step against | traced | reproduced from the files | chain: multiplier 1.0 at head on 2 endpoints | holds |
| C045 | /t/0xa5d4968421ba94814be3b136b15cf422101ac1a3/ [none] | og:image | https://www.exdate.me/t/0xa5d4968421ba94814be3b136b15cf422101ac1a3/opengraph-image?28f3018767a00d7f |  | traced | reproduced from the files | chain: multiplier 1.0 at head on 2 endpoints | holds |
| C046 | /badge/0xa5d4968421ba94814be3b136b15cf422101ac1a3.svg [none] | badge value | Intuitive Machines (LUNR) on exdate: no dividend declared |  | traced | reproduced from the files | chain: multiplier 1.0 at head on 2 endpoints | holds |
| C047 | /t/0xb0992820e760d836549ba69bc7598b4af75dee03/ [moved, 4 tokens] | answer | The multiplier last moved on 27 July 2026 with no dividend declared in the issuer’s feed. |  | traced | reproduced: step +22.11 bps, no issuer row (July loss) | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | holds |
| C048 | /t/0xb0992820e760d836549ba69bc7598b4af75dee03/ [moved] | stat: shares per token today | 1.002211 | since 27 Jul 2026 | traced | reproduced: step +22.11 bps, no issuer row (July loss) | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | holds |
| C049 | /t/0xb0992820e760d836549ba69bc7598b4af75dee03/ [moved] | stat: owed | — | nothing declared and unpaid | traced | reproduced: step +22.11 bps, no issuer row (July loss) | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | holds |
| C050 | /t/0xb0992820e760d836549ba69bc7598b4af75dee03/ [moved] | stat: no dividend measured yet | — | 1 change on chain | traced | reproduced: step +22.11 bps, no issuer row (July loss) | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | holds |
| C051 | /t/0xb0992820e760d836549ba69bc7598b4af75dee03/ [moved] | stat: Chainlink price feed | yes | paired by ticker only | traced | reproduced: step +22.11 bps, no issuer row (July loss) | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | holds |
| C052 | /t/0xb0992820e760d836549ba69bc7598b4af75dee03/ [moved] | dividend row: 27 Jul 2026 on chain Step observed +0.22 | — \| — \| — \| nothing declared |  | traced | reproduced: no issuer row inside the 4-day window | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | holds ('nothing declared'; July loss is known gap 1.6) |
| C053 | /t/0xb0992820e760d836549ba69bc7598b4af75dee03/ [moved] | og:image | https://www.exdate.me/t/0xb0992820e760d836549ba69bc7598b4af75dee03/opengraph-image?28f3018767a00d7f |  | traced | reproduced: step +22.11 bps, no issuer row (July loss) | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | holds |
| C054 | /badge/0xb0992820e760d836549ba69bc7598b4af75dee03.svg [moved] | badge value | Oracle (ORCL) on exdate: moved on chain, nothing declared |  | traced | reproduced: step +22.11 bps, no issuer row (July loss) | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | holds |
| C055 | /t/0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3/ [next, 21 tokens] | answer | Next dividend declared for 14 September 2026 : $ 0.2200 per share. Nothing is owed yet. |  | traced | reproduced: owed = 0.22 x 1.0 | issuer API refetched 2026-09-05T19:55Z; map | holds |
| C056 | /t/0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3/ [next] | stat: shares per token today | 1 | unchanged since launch | traced | reproduced: owed = 0.22 x 1.0 | issuer API refetched 2026-09-05T19:55Z; map | holds |
| C057 | /t/0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3/ [next] | stat: per share, declared | $0.2200 | for 14 Sept 2026 · nothing owed yet | traced | reproduced: owed = 0.22 x 1.0 | issuer API refetched 2026-09-05T19:55Z; map | holds |
| C058 | /t/0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3/ [next] | stat: no dividend measured yet | — |  | traced | reproduced: owed = 0.22 x 1.0 | issuer API refetched 2026-09-05T19:55Z; map | holds |
| C059 | /t/0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3/ [next] | stat: Chainlink price feed | yes | paired by ticker, confirmed by its price | traced | reproduced: owed = 0.22 x 1.0 | issuer API refetched 2026-09-05T19:55Z; map | holds |
| C060 | /t/0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3/ [next] | dividend row: 14 Sept 2026 issuer’s date Declared for  | $0.2200 \| — \| $0.2200 \| upcoming |  | traced | reproduced: owed = 0.22 x 1.0 | issuer API refetched 2026-09-05T19:55Z; map | holds |
| C061 | /t/0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3/ [next] | og:image | https://www.exdate.me/t/0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3/opengraph-image?28f3018767a00d7f |  | traced | reproduced: owed = 0.22 x 1.0 | issuer API refetched 2026-09-05T19:55Z; map | holds |
| C062 | /badge/0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3.svg [next] | badge value | Alphabet Class A (GOOGL) on exdate: dividend declared for 14 Sep |  | traced | reproduced: owed = 0.22 x 1.0 | issuer API refetched 2026-09-05T19:55Z; map | holds |
| C063 | /t/0x25c288e6d899b9bc30160965ad9644c67e73be0c/ [measured, 5 tokens] | answer | Last dividend on chain, 1 September 2026 : $ 0.1500 declared, and no price feed to measure what arrived . |  | traced | reproduced | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; capture record | holds |
| C064 | /t/0x25c288e6d899b9bc30160965ad9644c67e73be0c/ [measured] | stat: shares per token today | 1.000146 | since 2 Sept 2026 | traced | reproduced | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; capture record | holds |
| C065 | /t/0x25c288e6d899b9bc30160965ad9644c67e73be0c/ [measured] | stat: owed | — | nothing declared and unpaid | traced | reproduced | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; capture record | holds |
| C066 | /t/0x25c288e6d899b9bc30160965ad9644c67e73be0c/ [measured] | stat: last dividend not measurable | — | no price feed | traced | reproduced | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; capture record | holds |
| C067 | /t/0x25c288e6d899b9bc30160965ad9644c67e73be0c/ [measured] | stat: Chainlink price feed | no | nothing to price a step against | traced | reproduced | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; capture record | holds |
| C068 | /t/0x25c288e6d899b9bc30160965ad9644c67e73be0c/ [measured] | dividend row: 1 Sept 2026 issuer’s date Price at the s | $0.1500 \| — \| — \| no price feed |  | traced | reproduced | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; capture record | holds |
| C069 | /t/0x25c288e6d899b9bc30160965ad9644c67e73be0c/ [measured] | og:image | https://www.exdate.me/t/0x25c288e6d899b9bc30160965ad9644c67e73be0c/opengraph-image?28f3018767a00d7f |  | traced | reproduced | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; capture record | holds |
| C070 | /badge/0x25c288e6d899b9bc30160965ad9644c67e73be0c.svg [measured] | badge value | Ford Motor (F) on exdate: dividend on chain, not measurable |  | traced | reproduced | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; capture record | holds |
| C071 | /t/0x2f62fc9fabb470c690f141c28340ed832bb27020/ [owed, 14 tokens] | answer | 2 dividends are owed and not yet on chain , the oldest declared for 5 August 2026 ; the issuer already calls some of them paid . |  | traced | reproduced: owed = rate x 1.0 (0.2516 / 0.2529) | issuer API refetched 2026-09-05T19:55Z; chain multiplier at head | holds |
| C072 | /t/0x2f62fc9fabb470c690f141c28340ed832bb27020/ [owed] | stat: shares per token today | 1 | unchanged since launch | traced | reproduced: owed = rate x 1.0 (0.2516 / 0.2529) | issuer API refetched 2026-09-05T19:55Z; chain multiplier at head | holds |
| C073 | /t/0x2f62fc9fabb470c690f141c28340ed832bb27020/ [owed] | stat: dividends owed, not on chain | 2 | declared for 5 Aug 2026 | traced | reproduced: owed = rate x 1.0 (0.2516 / 0.2529) | issuer API refetched 2026-09-05T19:55Z; chain multiplier at head | holds |
| C074 | /t/0x2f62fc9fabb470c690f141c28340ed832bb27020/ [owed] | stat: no dividend measured yet | — |  | traced | reproduced: owed = rate x 1.0 (0.2516 / 0.2529) | issuer API refetched 2026-09-05T19:55Z; chain multiplier at head | holds |
| C075 | /t/0x2f62fc9fabb470c690f141c28340ed832bb27020/ [owed] | stat: Chainlink price feed | no | nothing to price a step against | traced | reproduced: owed = rate x 1.0 (0.2516 / 0.2529) | issuer API refetched 2026-09-05T19:55Z; chain multiplier at head | holds |
| C076 | /t/0x2f62fc9fabb470c690f141c28340ed832bb27020/ [owed] | dividend row: 3 Sept 2026 issuer’s date Declared for 3 | $0.2529 \| — \| $0.2529 \| due |  | traced | reproduced: owed = rate x 1.0 (0.2516 / 0.2529) | issuer API refetched 2026-09-05T19:55Z; chain multiplier at head | holds |
| C077 | /t/0x2f62fc9fabb470c690f141c28340ed832bb27020/ [owed] | dividend row: 5 Aug 2026 issuer’s date Declared for 5  | $0.2516 \| — \| $0.2516 \| issuer says paid |  | traced | reproduced: owed = rate x 1.0 (0.2516 / 0.2529) | issuer API refetched 2026-09-05T19:55Z; chain multiplier at head | holds |
| C078 | /t/0x2f62fc9fabb470c690f141c28340ed832bb27020/ [owed] | og:image | https://www.exdate.me/t/0x2f62fc9fabb470c690f141c28340ed832bb27020/opengraph-image?28f3018767a00d7f |  | traced | reproduced: owed = rate x 1.0 (0.2516 / 0.2529) | issuer API refetched 2026-09-05T19:55Z; chain multiplier at head | holds |
| C079 | /badge/0x2f62fc9fabb470c690f141c28340ed832bb27020.svg [owed] | badge value | Vanguard Total Bond Market ETF (BND) on exdate: 2 dividends owed, not on chain |  | traced | reproduced: owed = rate x 1.0 (0.2516 / 0.2529) | issuer API refetched 2026-09-05T19:55Z; chain multiplier at head | holds |
| C080 | /about/ | stat: warning before a change | ~10 min | 12 changes so far | traced | recomputed: median 9.6 min, 11 of 12 within 10 min | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | holds |
| C081 | /about/ | stat: after the issuer’s date | 1 day | 4 of 6 datable cases | traced | recomputed: lags 1,1,3,1,3,1 -> median 1 day, 4 of 6 at 1 day | issuer API refetched 2026-09-05T19:55Z | holds |
| C082 | /about/ | stat: Stock Tokens read | 194 | last observed 5 September 2026 | traced | refetched: 194 | issuer API refetched 2026-09-05T19:55Z | holds |
| C083 | /tokenlist.json | tokens | 194 |  | traced | rebuilt from committed data: NOT byte-identical (DELL corroboration, F03) | n/a | holds |
| C084 | /tokenlist.json | version | {"major": 1, "minor": 0, "patch": 3} | 2026-09-05T06:38:51.926Z | traced | rebuilt from committed data: NOT byte-identical (DELL corroboration, F03) | n/a | holds |
| C085 | /tokenlist.json | SGOV extensions | {"underlyingSharesPerToken": "1.005101770003214918", "isin": "US46436E7186", "priceFeed": "0xa0DF4ee0fFf975306345875E3548Fcc519577A11", "priceFeedCorroboratedBy": "multiplier-step,traded-price", "dividendDeclaredNotOnChain": true, "dividendOwedPerToken": "0.308665", "dividendProcessDate": "2026-09-0 |  | traced | reproduced: multiplier, owed 0.306812 x 1.005102 = 0.308665 | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; issuer API refetched 2026-09-05T19:55Z | holds |
| C086 | /calendar.ics | VEVENT count | 49 | 20260905T171626Z | traced; INCOMPLETE: VRT, AVGO, UPS absent (F01, F02) | recounted 49; CRLF, 75-octet folding, unique UIDs verified | n/a | S3 (F02) |
| C087 | /feed.xml | items | 49 | Sat, 05 Sep 2026 17:16:26 GMT | traced; INCOMPLETE: VRT, AVGO, UPS absent (F01, F02) | recounted 49; CRLF, 75-octet folding, unique UIDs verified | n/a | S3 (F02) |
| C088 | /badge.svg | title | exdate: 36% of Apple’s last dividend never arrived on chain |  | traced | reproduced by hand: 3601.81 bps -> 3601 (floor) / 3602 (round); received 0.172751 | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; Chainlink directory refetched 2026-09-05T19:55Z; round read from the aggregator | holds; S4 price stored at 4 dp (F08) |
| C089 | /t/0xf23250dac154d05bb671cb0d0ebef3c635c79ce2/ [UPS] | answer: One dividend is owed and not yet on chain: declared for 3 September 2026, $1.6400 per token | owed | 3 Sept 2026 | traced to a stale file | CONTRADICTED: chain multiplier 1.002208724969205741 on 2 endpoints; log 0xc3a0a692… at block 54355503; API pending nothingPending=true | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only; live API; capture record | S0: the dividend landed on 2026-09-04 15:10:26 UTC (F01) |
| C090 | /t/0xf23250dac154d05bb671cb0d0ebef3c635c79ce2/ [UPS] | stat: shares per token today | 1 | unchanged since launch | traced to a stale scan (through block 52672800) | CONTRADICTED: 1.002209 on chain | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | S0 (F01) |
| C091 | /badge/0xf23250dac154d05bb671cb0d0ebef3c635c79ce2.svg [UPS] | badge value: dividend owed, not on chain |  |  | traced to a stale file | CONTRADICTED | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | S0 (F01) |
| C092 | /tokenlist.json [UPS] | extensions.underlyingSharesPerToken / dividendDeclaredNotOnChain | 1 / true | 2026-09-05T06:38:51Z | traced to a stale scan | CONTRADICTED: 1.002208724969205741 on chain | chain: 2 endpoints at head (blockmachine, Robinhood); state at the step: blockmachine only | S0 (F01) |
