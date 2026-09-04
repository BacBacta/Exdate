/**
 * Validation for a Uniswap token list.
 *
 * A token list is how a wallet or an aggregator learns that a token exists, so it is
 * exdate's cheapest distribution: not another page, but a file other people's products
 * import. It is only useful if it is actually valid - a list that fails the schema is
 * silently ignored by every consumer, which looks exactly like nobody wanting it.
 *
 * The constraints below are read from the published schema
 * (Uniswap/token-lists src/tokenlist.schema.json) rather than remembered. They are
 * checked here, with tests, so the builder can refuse to write an invalid file instead
 * of publishing one that no consumer will load.
 */

/** Word characters and spaces only. The schema forbids hyphens and punctuation in a list name or keyword. */
const WORD_AND_SPACE = /^[\w ]+$/
const ADDRESS = /^0x[a-fA-F0-9]{40}$/
const NO_CONTROL = /^[ \S]+$/

export interface TokenListVersion {
  major: number
  minor: number
  patch: number
}

export interface TokenListEntry {
  chainId: number
  address: string
  name: string
  symbol: string
  decimals: number
  logoURI?: string
  extensions?: Record<string, unknown>
}

export interface TokenList {
  name: string
  timestamp: string
  version: TokenListVersion
  tokens: TokenListEntry[]
  keywords?: string[]
  logoURI?: string
}

/** Every way the list breaks the schema, in the order a reader would fix them. Empty means valid. */
export function validateTokenList(list: TokenList): string[] {
  const problems: string[] = []
  const say = (message: string) => problems.push(message)

  if (!list.name || list.name.length > 30) say(`name must be 1 to 30 characters, got ${list.name?.length ?? 0}`)
  else if (!WORD_AND_SPACE.test(list.name)) say(`name may only contain word characters and spaces: "${list.name}"`)

  if (Number.isNaN(Date.parse(list.timestamp))) say(`timestamp is not a date: "${list.timestamp}"`)

  for (const part of ['major', 'minor', 'patch'] as const) {
    const value = list.version?.[part]
    if (!Number.isInteger(value) || (value as number) < 0) say(`version.${part} must be a non-negative integer`)
  }

  for (const keyword of list.keywords ?? []) {
    if (!keyword || keyword.length > 20) say(`keyword must be 1 to 20 characters: "${keyword}"`)
    else if (!WORD_AND_SPACE.test(keyword)) say(`keyword may only contain word characters and spaces: "${keyword}"`)
  }

  if (!Array.isArray(list.tokens) || list.tokens.length === 0) say('tokens must be a non-empty array')

  const seen = new Set<string>()
  for (const token of list.tokens ?? []) {
    const where = `${token.symbol ?? token.address}`
    if (!ADDRESS.test(token.address ?? '')) say(`${where}: address is not a 20-byte hex address`)
    else {
      const key = `${token.chainId}:${token.address.toLowerCase()}`
      if (seen.has(key)) say(`${where}: the same address appears twice on chain ${token.chainId}`)
      seen.add(key)
    }
    if (!Number.isInteger(token.chainId) || token.chainId < 1) say(`${where}: chainId must be a positive integer`)
    if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 255) say(`${where}: decimals must be 0 to 255`)
    if (token.name === undefined || token.name.length > 60) say(`${where}: name must be at most 60 characters`)
    else if (token.name !== '' && !NO_CONTROL.test(token.name)) say(`${where}: name contains a control character`)
    if (token.symbol === undefined || token.symbol.length > 20) say(`${where}: symbol must be at most 20 characters`)
    else if (token.symbol !== '' && /\s/.test(token.symbol)) say(`${where}: symbol may not contain whitespace`)
    const extensions = Object.keys(token.extensions ?? {})
    if (extensions.length > 10) say(`${where}: at most 10 extensions, got ${extensions.length}`)
    for (const [key, value] of Object.entries(token.extensions ?? {})) {
      if (value === undefined) say(`${where}: extension "${key}" is undefined; omit it or use null`)
    }
  }
  return problems
}

/**
 * What the next version is, given what changed.
 *
 * The standard reads a version like a promise to consumers: removing or renaming a
 * token can break them, so it is major; adding one cannot, so it is minor; changing a
 * detail is a patch. Computing it from the diff rather than by hand is what keeps that
 * promise true.
 */
export function nextTokenListVersion(
  previous: TokenListVersion | undefined,
  before: readonly TokenListEntry[],
  after: readonly TokenListEntry[],
): TokenListVersion {
  const base = previous ?? { major: 0, minor: 0, patch: 0 }
  if (before.length === 0) return { major: Math.max(base.major, 1), minor: 0, patch: 0 }
  const key = (token: TokenListEntry) => `${token.chainId}:${token.address.toLowerCase()}`
  const beforeByKey = new Map(before.map((token) => [key(token), token]))
  const afterByKey = new Map(after.map((token) => [key(token), token]))

  const removed = [...beforeByKey.keys()].some((k) => !afterByKey.has(k))
  if (removed) return { major: base.major + 1, minor: 0, patch: 0 }

  const added = [...afterByKey.keys()].some((k) => !beforeByKey.has(k))
  if (added) return { major: base.major, minor: base.minor + 1, patch: 0 }

  const changed = [...afterByKey].some(([k, token]) => JSON.stringify(token) !== JSON.stringify(beforeByKey.get(k)))
  if (changed) return { major: base.major, minor: base.minor, patch: base.patch + 1 }

  return base
}
