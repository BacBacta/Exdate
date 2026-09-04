import { describe, expect, it } from 'vitest'
import { nextTokenListVersion, validateTokenList, type TokenList, type TokenListEntry } from '../src/tokenlist.js'

const token = (over: Partial<TokenListEntry> = {}): TokenListEntry => ({
  chainId: 4663,
  address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9',
  name: 'Apple',
  symbol: 'AAPL',
  decimals: 18,
  ...over,
})
const list = (over: Partial<TokenList> = {}): TokenList => ({
  name: 'exdate Robinhood Stock Tokens',
  timestamp: '2026-09-04T07:00:00.000Z',
  version: { major: 1, minor: 0, patch: 0 },
  keywords: ['tokenized stocks', 'robinhood'],
  tokens: [token()],
  ...over,
})

describe('validateTokenList', () => {
  it('passes the list exdate publishes', () => {
    expect(validateTokenList(list())).toEqual([])
  })

  it('holds the list name to 30 characters of words and spaces', () => {
    expect(validateTokenList(list({ name: 'x'.repeat(31) }))[0]).toMatch(/1 to 30 characters/)
    // A hyphen is the trap: it reads as ordinary punctuation and the schema forbids it.
    expect(validateTokenList(list({ name: 'exdate - stock tokens' }))[0]).toMatch(/word characters and spaces/)
    expect(validateTokenList(list({ name: 'exdate Robinhood Stock Tokens' }))).toEqual([])
  })

  it('holds keywords to the same alphabet', () => {
    expect(validateTokenList(list({ keywords: ['real-world assets'] }))[0]).toMatch(/word characters and spaces/)
    expect(validateTokenList(list({ keywords: ['x'.repeat(21)] }))[0]).toMatch(/1 to 20 characters/)
  })

  it('refuses a version that is not three non-negative integers', () => {
    expect(validateTokenList(list({ version: { major: 1, minor: -1, patch: 0 } }))[0]).toMatch(/version.minor/)
    expect(validateTokenList(list({ version: { major: 1.5, minor: 0, patch: 0 } }))[0]).toMatch(/version.major/)
  })

  it('refuses a timestamp that is not a date, and an empty token array', () => {
    expect(validateTokenList(list({ timestamp: 'yesterday' }))[0]).toMatch(/not a date/)
    expect(validateTokenList(list({ tokens: [] }))[0]).toMatch(/non-empty/)
  })

  it('checks every token: address, chain, decimals, name and symbol', () => {
    expect(validateTokenList(list({ tokens: [token({ address: '0x1234' })] }))[0]).toMatch(/not a 20-byte hex address/)
    expect(validateTokenList(list({ tokens: [token({ chainId: 0 })] }))[0]).toMatch(/positive integer/)
    expect(validateTokenList(list({ tokens: [token({ decimals: 256 })] }))[0]).toMatch(/0 to 255/)
    expect(validateTokenList(list({ tokens: [token({ name: 'x'.repeat(61) })] }))[0]).toMatch(/at most 60/)
    expect(validateTokenList(list({ tokens: [token({ symbol: 'A B' })] }))[0]).toMatch(/whitespace/)
    // The longest real name is 57 characters, which fits.
    expect(validateTokenList(list({ tokens: [token({ name: 'Space Exploration Technologies Corp. Class A Common Stock' })] }))).toEqual([])
  })

  it('catches the same address listed twice, whatever its casing', () => {
    const duplicated = [token(), token({ address: token().address.toLowerCase() })]
    expect(validateTokenList(list({ tokens: duplicated }))[0]).toMatch(/appears twice/)
  })

  it('holds extensions to ten, and refuses an undefined value that JSON would drop silently', () => {
    const many = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, i]))
    expect(validateTokenList(list({ tokens: [token({ extensions: many })] }))[0]).toMatch(/at most 10 extensions/)
    expect(validateTokenList(list({ tokens: [token({ extensions: { isin: undefined } })] }))[0]).toMatch(/is undefined/)
  })
})

describe('nextTokenListVersion', () => {
  const a = token()
  const b = token({ address: '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5', symbol: 'SGOV', name: 'iShares 0-3 Month Treasury Bond' })

  it('starts at 1.0.0', () => {
    expect(nextTokenListVersion(undefined, [], [a])).toEqual({ major: 1, minor: 0, patch: 0 })
  })

  it('adding a token is a minor bump: it cannot break a consumer', () => {
    expect(nextTokenListVersion({ major: 1, minor: 2, patch: 3 }, [a], [a, b])).toEqual({ major: 1, minor: 3, patch: 0 })
  })

  it('removing one is a major bump: it can', () => {
    expect(nextTokenListVersion({ major: 1, minor: 2, patch: 3 }, [a, b], [a])).toEqual({ major: 2, minor: 0, patch: 0 })
  })

  it('changing a detail is a patch', () => {
    const renamed = { ...a, extensions: { multiplier: '1.000566' } }
    expect(nextTokenListVersion({ major: 1, minor: 2, patch: 3 }, [a], [renamed])).toEqual({ major: 1, minor: 2, patch: 4 })
  })

  it('leaves the version alone when nothing moved, so an unchanged rebuild is a no-op', () => {
    expect(nextTokenListVersion({ major: 1, minor: 2, patch: 3 }, [a, b], [a, b])).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  it('a removal outranks an addition in the same rebuild', () => {
    expect(nextTokenListVersion({ major: 1, minor: 2, patch: 3 }, [a], [b])).toEqual({ major: 2, minor: 0, patch: 0 })
  })
})
