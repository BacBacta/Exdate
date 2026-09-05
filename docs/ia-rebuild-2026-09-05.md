# Reconstruction de l'architecture du site — 5 septembre 2026

Diagnostic mesuré sur le build du soir, puis la structure reconstruite. En français, pour le
propriétaire ; le code et les libellés du site restent en anglais.

## 1. Ce que le site était

Inventaire de chaque route rendue (`apps/web/out`), texte visible hors pied de page.

| Route | Mots | Écrans à 360 px | Paragraphes > 35 mots | Plus long | Sections | Liens |
|---|---|---|---|---|---|---|
| `/` | 391 | 5,8 | 2 | 49 | 5 | 18 |
| `/how/` | 271 | 4,4 | 2 | 47 | 4 | 1 |
| `/dividends/` | 373 | 6,0 | 2 | 49 | 3 | 22 |
| `/calendar/` | 856 | 12,7 | 1 | 39 | 2 | 40 |
| `/wallet/` | 206 | 2,6 | 3 | 48 | 2 | 0 |
| `/gap/` | 1 232 | 16,3 | 4 | 141 | 6 | 38 |
| `/flows/` | 679 | 12,7 | 3 | 76 | 3 | 38 |
| `/record/` | 471 | 7,0 | 3 | 54 | 5 | 8 |
| `/data/` | 447 | — | 2 | 62 | 2 | 15 |
| `/about/` | 328 | 3,9 | 4 | 75 | 2 | 1 |
| `/docs/` | 235 | 3,5 | 1 | 57 | 2 | 8 |
| `/t/…` (SGOV) | 684 | 6,5 | 3 | 68 | 4 | 13 |
| `/t/…` (AAPL) | 395 | — | 3 | 58 | 4 | 9 |
| `/t/…` (sans dividende) | 186 | — | 2 | 48 | 3 | 2 |

Pied de page : 19 liens, 104 mots. En-tête : Tokens · Wallet · Calendar · Oracle · Docs.

## 2. Ce qui ne va pas, page par page

**Le défaut commun.** Chaque page explique sa propre méthode dans le flux de lecture : d'où vient
le chiffre, combien d'échantillons, ce qui est refusé et pourquoi. C'est juste pour la donnée et
pour l'API ; c'est faux comme couche de lecture par défaut d'un site. Un lecteur qui arrive avec
une question reçoit un cahier de laboratoire. Les qualificatifs doivent être **disponibles**, pas
**affichés**.

**Le second défaut.** Onze surfaces de premier niveau pour cinq questions. Trois pages parlent de
dividendes sous trois angles (`/dividends/` ce qui est arrivé, `/calendar/` ce qui est déclaré,
`/record/` combien de temps ça prend) et un détenteur ne sait pas laquelle ouvrir. Deux pages
« marché » (`/gap/`, `/flows/`), deux pages « à propos » (`/how/`, `/about/`).

- **Accueil.** Trois figures mesurées portées chacune par une phrase de 40 mots (date, échantillon,
  méthode, lien). Puis deux paragraphes (« Where it looks », « Built to integrate ») qui n'appellent
  aucune action. 391 mots pour faire chercher un token.
- **Page token.** La phrase de réponse en tête est bonne. Ensuite : un bloc de statistiques, une liste
  de dividendes dont chaque ligne répète ses libellés, un paragraphe de définitions, un bloc
  d'abonnement avec une URL en clair, un bloc « embed », l'historique du multiplicateur avec un
  paragraphe d'introduction et une ligne technique par changement (« confirmed in state at block
  51274928 »), un paragraphe de 60 mots sur le feed. Six sections pour « ai-je eu mon dividende ? ».
- **`/gap/`.** 1 232 mots, 16 écrans. Un paragraphe de 141 mots sous le tableau. Chaque ligne du
  tableau porte une sous-ligne de 60 caractères (« SNDK · oracle 19 h old · pool $52,127 · pairing:
  ticker only ») au lieu de colonnes. 41 tokens sans oracle listés. Deux paragraphes finaux sur la
  méthode d'appariement.
- **`/calendar/`.** 37 lignes en quatre groupes, chaque groupe avec un titre et un paragraphe
  d'introduction ; 12,7 écrans.
- **`/flows/`.** 40 lignes de tableau et trois paragraphes de méthode.
- **`/record/`.** Une page de méthodologie : « How much warning », « How long after », « What can be
  measured and what stops the rest », le nom de la machine qui capture. C'est une page pour l'auteur,
  pas pour un lecteur.
- **`/wallet/`.** Trois paragraphes de 40 à 48 mots avant le bouton *Read*.
- **Pied de page.** 19 liens en trois colonnes : un plan de site.

## 3. Cinq règles pour la reconstruction

1. **Une page répond à une question, nommée dans son titre.** Le premier écran répond avec des
   chiffres et un tableau, jamais avec des phrases.
2. **Une phrase au plus par section, vingt mots au plus.** Les libellés sont des mots, pas des
   phrases : *Declared*, *Arrived*, *Gap*, *Owed*, *Feed*.
3. **Toute méthode derrière un seul « How this is measured » par page.** Date et taille
   d'échantillon sur une petite ligne sous le chiffre (« 57 samples · 3–5 Sep »), jamais dans une
   phrase.
4. **Six surfaces, pas onze.** Les anciennes adresses redirigent.
5. **Un tableau est un tableau.** `<table>` avec un en-tête sur grand écran, cartes avec libellés
   sur petit écran. Plus de grille de `div` qui répète ses libellés à chaque ligne.

Les règles du dépôt tiennent toujours : aucun chiffre inventé, chaque chiffre daté et traçable, un
prix Chainlink jamais multiplié. Ce qui change est la place de la preuve, pas son existence.

## 4. La structure

```
En-tête      exdate · Tokens · Dividends · Wallet · Market · Docs

/            Accueil : titre, une phrase, chercheur, l'anneau
             « Dividends » : 4 chiffres, les 6 dividendes arrivés en tableau, un lien
             « What we measured » : 3 tuiles (chiffre, 5 mots, date), un lien « how »
/t/<addr>/   Token : la réponse en tête (conservée)
             4 tuiles : represents · owed · last dividend · price feed
             « Dividends » : un tableau, une ligne par dividende, détail dépliable
             « Multiplier changes (n) » : replié
             « Price feed » : replié
             une ligne de liens : Calendar (.ics) · RSS · Badge · Explorer
/dividends/  Fusionne /dividends/, /calendar/, /record/
             6 chiffres : declared · issuer says paid · landed · measured · warning · lag
             deux segments : Coming (37) | Landed (12), un tableau chacun
             filtre ?tokens= (depuis le wallet), liens .ics / RSS
             « How this is measured » : replié, porte tout /record/
/wallet/     Le formulaire seul au-dessus du pli, une ligne sous le champ
             Résultats : 3 tuiles puis le tableau ; historique inchangé, méthode repliée
/market/     Fusionne /gap/ et /flows/
             4 chiffres : median gap · widest · median feed age · tokens
             « Traded vs oracle » : tableau en colonnes (feed age, pool, pairing), recherche, tri
             « By session » : tableau compact
             « Net creation » : 1 chiffre, deux tableaux courts
             « How this is measured » : replié
/about/      Fusionne /how/ et /about/ : 3 étapes, couverture, refus, qui, contact, licences
/docs/       Inchangé (déjà compact) ; /data/ reste, lié depuis /docs/

Redirections /calendar/ /record/ → /dividends/ ; /gap/ /flows/ → /market/ ; /how/ → /about/
Pied de page trois colonnes de quatre liens, une ligne légale
```

## 5. Composants

- **Stats** : une rangée de tuiles ; chaque tuile = chiffre, libellé de cinq mots, ligne de date en
  petit. Aucune phrase.
- **Table** : `<table>` réel ; sur petit écran chaque ligne devient une carte dont chaque cellule
  porte son libellé via `data-label`.
- **Chip** : un état en trois mots au plus : *owed*, *36% never arrived*, *no price feed*, *nothing
  declared*, *due*, *upcoming*, *overdue*, *issuer says paid*.
- **Method** : `<details>` « How this is measured », un par page, fermé par défaut.
- **Links** : une ligne de petits liens (abonnement, badge, explorateur), jamais un bloc.

## 6. Mesuré après reconstruction

Même script que le diagnostic, sur le build. « Mots ouverts » compte le texte visible avec chaque
bloc replié fermé, ce qu'un lecteur voit en arrivant.

| Page | Mots avant → après (ouverts) | Écrans mobile avant → après | Paragraphes > 35 mots |
|---|---|---|---|
| `/` | 391 → 260 | 5,8 → 4,5 | 2 → 0 |
| Token (SGOV) | 684 → 211 | 6,5 → 3,5 | 3 → 0 |
| `/dividends/` (3 pages → 1) | 1 700 → 757 | 25,7 → 8,1 | 6 → 0 |
| `/market/` (2 pages → 1) | 1 911 → 614 | 29,0 → 9,7 | 7 → 0 |
| `/about/` (2 pages → 1) | 599 → 270 | 8,3 → 4,1 | 6 → 1 |
| `/wallet/` | 206 → 50 | 2,6 → 2,1 | 3 → 0 |

Pied de page : 19 → 13 liens. En-tête : Tokens · Dividends · Wallet · Market · Docs. Onze routes
de premier niveau → six, plus les pages token et la doc ; les cinq anciennes adresses redirigent
en 308. Les deux pages listes (`/dividends/`, `/market/`) restent longues sur mobile parce qu'elles
listent 37 et 26 lignes ; chaque ligne y est une carte de deux lignes, et une seule des deux listes
de `/dividends/` est affichée à la fois. Aucun débordement à 320 ni 360 px, axe sans violation sur
les onze routes mesurées.

Les cibles de mots pour `/dividends/` et `/market/` n'étaient pas tenables sans tronquer les
listes : les mots restants y sont des données de tableau (un nom, une date, trois montants par
ligne), pas de la prose. La prose, qui était le problème, est à zéro paragraphe long sur ces deux
pages.
