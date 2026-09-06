import { describe, expect, it } from 'vitest'
import { cusipCheckDigit, cusipFromIsin, identifiersFor, isValidCusip } from '../src/identifiers.js'
import { REGISTRY_TOKENS } from '../src/generated/registry.js'

describe('cusipFromIsin', () => {
  it('extracts the CUSIP a US ISIN contains, checked', () => {
    // Apple: US ISIN = US + CUSIP + the ISIN's own check digit.
    expect(cusipFromIsin('US0378331005')).toBe('037833100')
    expect(cusipFromIsin('US5949181045')).toBe('594918104') // Microsoft
    expect(cusipFromIsin('US79466L3024')).toBe('79466L302') // Salesforce, a letter inside
  })

  it('refuses every ISIN that is not American, because there is no CUSIP inside one', () => {
    expect(cusipFromIsin('BMG2109G1033')).toBeNull() // Carnival, Bermuda
    expect(cusipFromIsin('KYG6683N1034')).toBeNull() // Cayman
    expect(cusipFromIsin('CA0585861085')).toBeNull() // Canada
    expect(cusipFromIsin('NL0009805522')).toBeNull()
    expect(cusipFromIsin('IL0010823388')).toBeNull()
  })

  it('refuses malformed input rather than returning something plausible', () => {
    expect(cusipFromIsin(null)).toBeNull()
    expect(cusipFromIsin(undefined)).toBeNull()
    expect(cusipFromIsin('')).toBeNull()
    expect(cusipFromIsin('US037833100')).toBeNull() // eleven characters
    expect(cusipFromIsin('us0378331005')).toBeNull() // lowercase is not an ISIN
    // Twelve characters, US prefix, but the CUSIP inside fails its own check digit. This is the
    // case a substring-only implementation would get wrong: it looks exactly like a CUSIP.
    expect(cusipFromIsin('US0378331015')).toBeNull()
  })

  it('checks the check digit the way the standard defines it', () => {
    expect(cusipCheckDigit('03783310')).toBe(0)
    expect(cusipCheckDigit('59491810')).toBe(4)
    expect(cusipCheckDigit('short')).toBeNull()
    expect(isValidCusip('037833100')).toBe(true)
    expect(isValidCusip('037833101')).toBe(false)
    expect(isValidCusip('0378331')).toBe(false)
  })

  it('derives a CUSIP for every US ISIN in the registry, and for no other', () => {
    const rows = REGISTRY_TOKENS.map((token) => ({ isin: token.isin, cusip: cusipFromIsin(token.isin) }))
    const american = rows.filter((row) => row.isin?.startsWith('US'))
    expect(rows).toHaveLength(194)
    expect(american.length).toBeGreaterThan(0)
    // Every American one yields a CUSIP that passes its own check digit …
    expect(american.every((row) => row.cusip !== null && isValidCusip(row.cusip))).toBe(true)
    // … and no non-American one yields anything at all.
    expect(rows.filter((row) => !row.isin?.startsWith('US')).every((row) => row.cusip === null)).toBe(true)
  })
})

describe('the FIGIs joined into the registry', () => {
  it('gives every token a share class, which is the identifier a Stock Token actually has', () => {
    const missing = REGISTRY_TOKENS.filter((token) => token.shareClassFigi === null)
    expect(missing.map((token) => token.symbol)).toEqual([])
  })

  it('shapes every FIGI like a FIGI rather than trusting the join blindly', () => {
    // BBG + 8 alphanumerics + a check character. Wrong-shaped values are the way a bad join
    // shows itself: a null is a refusal, a malformed string is a claim.
    const shaped = /^BBG[0-9A-Z]{9}$/
    const bad = REGISTRY_TOKENS.filter(
      (token) =>
        (token.shareClassFigi !== null && !shaped.test(token.shareClassFigi)) ||
        (token.figi !== null && !shaped.test(token.figi)),
    )
    expect(bad.map((token) => `${token.symbol}:${token.figi}/${token.shareClassFigi}`)).toEqual([])
  })

  it('never gives two tokens the same share class', () => {
    // One share class is one asset. Two tokens sharing one would mean the ISIN join collapsed
    // two distinct assets onto one row, which is exactly the silent failure worth a test.
    const seen = new Map<string, string>()
    const collisions: string[] = []
    for (const token of REGISTRY_TOKENS) {
      if (token.shareClassFigi === null) continue
      const first = seen.get(token.shareClassFigi)
      if (first !== undefined) collisions.push(`${first} and ${token.symbol} share ${token.shareClassFigi}`)
      else seen.set(token.shareClassFigi, token.symbol)
    }
    expect(collisions).toEqual([])
  })

  it('builds the published block from the registry row, deriving the CUSIP rather than storing it', () => {
    const sgov = REGISTRY_TOKENS.find((token) => token.symbol === 'SGOV')!
    expect(identifiersFor(sgov)).toEqual({
      address: sgov.address,
      ticker: 'SGOV',
      isin: sgov.isin,
      cusip: cusipFromIsin(sgov.isin),
      figi: sgov.figi,
      shareClassFigi: sgov.shareClassFigi,
    })
    // Derived, so it cannot disagree with the ISIN beside it.
    expect(identifiersFor(sgov).cusip).toBe(sgov.isin!.slice(2, 11))
  })

  it('refuses a CUSIP for every non-US ISIN rather than inventing one', () => {
    const wrong = REGISTRY_TOKENS.filter(
      (token) => !token.isin?.startsWith('US') && identifiersFor(token).cusip !== null,
    )
    expect(wrong.map((token) => token.symbol)).toEqual([])
  })
})
