import type { ManifestConfig } from '../types'

const DEFAULT_MANIFEST_FILE_NAME = 'oss-manifest.json'

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
    return {
      prefix: protocolMatch[1],
      path: protocolMatch[2] || '',
    }
  }

  const protocolRelativeMatch = normalized.match(/^(\/\/[^/]+)(.*)$/)
  if (protocolRelativeMatch) {
    return {
      prefix: protocolRelativeMatch[1],
      path: protocolRelativeMatch[2] || '',
    }
  }

  if (normalized.startsWith('/')) {
    return {
      prefix: '/',
      path: normalized,
    }
  }

  return {
    prefix: '',
    path: normalized,
  }
}

export const normalizeUrlLikeBase = (base: string): string => {
  const { prefix, path } = splitUrlLikeBase(base)
  const normalizedPath = normalizePathSegments(path)

  if (!prefix) return normalizedPath
  if (!normalizedPath) return prefix
  if (prefix === '/') return `/${normalizedPath}`

  return `${prefix}/${normalizedPath}`
}

export const ensureTrailingSlash = (value: string): string => {
  if (!value || value.endsWith('/')) return value
  return `${value}/`
}

export const normalizeObjectKey = (targetDir: string, relativeFilePath: string): string =>
  normalizePathSegments(targetDir, relativeFilePath)

export const normalizeManifestFileName = (fileName?: string): string => {
  const value = normalizeSlash(fileName === undefined ? DEFAULT_MANIFEST_FILE_NAME : fileName)
  const segments = value.split('/')
  const isAbsolutePath = value.startsWith('/') || value.startsWith('//') || /^[a-zA-Z]:\//.test(value)

  if (isAbsolutePath || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('manifest.fileName must be a relative path inside outDir without "." or ".." segments')
  }

  const normalized = segments.filter(Boolean).join('/')
  if (!normalized) {
    throw new Error('manifest.fileName must not be empty')
  }

  return normalized
}

export const resolveManifestFileName = (manifest: ManifestConfig): string | null => {
  if (!manifest) return null
  if (manifest === true) return DEFAULT_MANIFEST_FILE_NAME
  return normalizeManifestFileName(manifest.fileName)
}

export const encodeUrlPath = (path: string): string =>
  normalizePathSegments(path)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

export const joinUrlPath = (base: string, path: string): string =>
  `${normalizeUrlLikeBase(base).replace(/\/+$/, '')}/${encodeUrlPath(path)}`

export const resolveUploadedFileUrl = (
  relativeFilePath: string,
  objectKey: string,
  configBase?: string,
  alias?: string,
): string => {
  if (configBase) return joinUrlPath(configBase, relativeFilePath)
  if (alias) return joinUrlPath(alias, objectKey)
  return objectKey
}
