export const normalizeSlash = (value: string): string => value.replace(/\\/g, '/').trim()

export const normalizePathSegments = (...values: Array<string | undefined>): string =>
  values
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => normalizeSlash(value).split('/'))
    .filter(Boolean)
    .join('/')

const splitUrlLikeBase = (value: string): { prefix: string; path: string } => {
  const normalized = normalizeSlash(value)
  const protocolMatch = normalized.match(/^([a-zA-Z][a-zA-Z\d+.-]*:\/\/[^/]+)(.*)$/)
  if (protocolMatch) {
    return { prefix: protocolMatch[1], path: protocolMatch[2] || '' }
  }

  const protocolRelativeMatch = normalized.match(/^(\/\/[^/]+)(.*)$/)
  if (protocolRelativeMatch) {
    return { prefix: protocolRelativeMatch[1], path: protocolRelativeMatch[2] || '' }
  }

  if (normalized.startsWith('/')) {
    return { prefix: '/', path: normalized }
  }

  return { prefix: '', path: normalized }
}

export const normalizeUrlLikeBase = (base: string): string => {
  const { prefix, path } = splitUrlLikeBase(base)
  const normalizedPath = normalizePathSegments(path)

  if (!prefix) return normalizedPath
  if (!normalizedPath) return prefix
  if (prefix === '/') return `/${normalizedPath}`
  return `${prefix}/${normalizedPath}`
}
