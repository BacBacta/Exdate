/**
 * Institutional identifiers, derived where they can be and refused where they cannot.
 *
 * The address stays the primary key everywhere - it is the only identifier that is first-party,
 * unambiguous and readable from the chain. These are the joins an integrator already has in their
 * own system: a tracker keys on ISIN, a tax package on CUSIP, an OMS on FIGI. Publishing them
 * beside the address is what lets someone match exdate's rows to theirs without a mapping table.
 *
 * Nothing here guesses. A CUSIP is derived only from a US ISIN, where it is the ISIN's own
 * substring and the derivation is exact; every other jurisdiction returns null, and how many that
 * is is published rather than hidden.
 */

/** Positional value of a CUSIP or ISIN character: 0-9, then A=10 … Z=35, then the three specials. */
function value(character: string): number {
  if (character >= '0' && character <= '9') return character.charCodeAt(0) - 48
  if (character >= 'A' && character <= 'Z') return character.charCodeAt(0) - 55
  if (character === '*') return 36
  if (character === '@') return 37
  if (character === '#') return 38
  return Number.NaN
}

/**
 * The CUSIP check digit, by the modulus-10 double-add-double the CUSIP standard defines.
 * Exported because the derivation below is only worth trusting if it is checked, and a caller
 * holding a CUSIP from elsewhere deserves the same check.
 */
export function cusipCheckDigit(first8: string): number | null {
  if (first8.length !== 8) return null
  let sum = 0
  for (let index = 0; index < 8; index++) {
    let digit = value(first8[index]!)
    if (Number.isNaN(digit)) return null
    if (index % 2 === 1) digit *= 2
    sum += Math.floor(digit / 10) + (digit % 10)
  }
  return (10 - (sum % 10)) % 10
}

/** True when a 9-character CUSIP carries its own correct check digit. */
export function isValidCusip(cusip: string): boolean {
  if (!/^[0-9A-Z*@#]{9}$/.test(cusip)) return false
  const expected = cusipCheckDigit(cusip.slice(0, 8))
  return expected !== null && expected === value(cusip[8]!)
}

/**
 * The CUSIP inside a US ISIN, or null.
 *
 * A US ISIN is `US` + the 9-character CUSIP + the ISIN's own check digit, so the CUSIP is a
 * substring and nothing is computed: this is a read, not a mapping. Everything else returns null -
 * a Bermudan, Caymanian, Israeli, Canadian, Australian or Dutch ISIN has no CUSIP to extract, and
 * inventing one would be exactly the kind of made-up identifier this project refuses.
 *
 * The extracted value is checked before it is returned: a malformed ISIN that happens to be twelve
 * characters long yields null rather than a plausible-looking wrong CUSIP.
 */
export function cusipFromIsin(isin: string | null | undefined): string | null {
  if (!isin || !/^US[0-9A-Z]{9}[0-9]$/.test(isin)) return null
  const cusip = isin.slice(2, 11)
  return isValidCusip(cusip) ? cusip : null
}

/** Every identifier exdate publishes for a token. `address` is the key; the rest are joins. */
export interface TokenIdentifiers {
  /** The contract address. The primary key: first-party, unambiguous, readable from the chain. */
  address: string
  /** The issuer's ticker. Displayed, never used as a key: two issuers can spell one asset differently. */
  ticker: string
  /** From the issuer's registry. */
  isin: string | null
  /** Derived from a US ISIN, checked; null for every other jurisdiction. */
  cusip: string | null
  /**
   * OpenFIGI's country-level composite, joined on ISIN and stored in data/figi.observed.json.
   * Null when the asset has no listing in the country its ISIN names - a FIGI pointing at the
   * wrong line is worse than absent.
   */
  figi: string | null
  /**
   * OpenFIGI's share class, one across every country and venue. This is the identifier that
   * actually describes a Stock Token: the token represents the share class, and is listed on no
   * venue at all, so the venue-level FIGI a market-data system would normally use does not exist
   * for it. Null only when the ISIN resolved to more than one share class, which nothing does today.
   */
  shareClassFigi: string | null
}

/** The shape the registry carries per token. Declared here so this module imports nothing. */
export interface IdentifiableToken {
  address: string
  symbol: string
  isin: string | null
  figi?: string | null
  shareClassFigi?: string | null
}

/**
 * The identifiers block every surface publishes, built from one registry row.
 *
 * One function rather than four call sites assembling the same object, because the block is
 * served by the API, the token list and the SDK, and three copies of it are three chances for one
 * of them to publish a CUSIP the others refuse.
 */
export function identifiersFor(token: IdentifiableToken): TokenIdentifiers {
  return {
    address: token.address,
    ticker: token.symbol,
    isin: token.isin ?? null,
    cusip: cusipFromIsin(token.isin),
    figi: token.figi ?? null,
    shareClassFigi: token.shareClassFigi ?? null,
  }
}
