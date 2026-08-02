import type { ManifestConfig } from '../types'
import { normalizePathSegments, normalizeSlash, normalizeUrlLikeBase } from '../../shared/path'

export { normalizePathSegments, normalizeSlash, normalizeUrlLikeBase } from '../../shared/path'

const DEFAULT_MANIFEST_FILE_NAME = 'oss-manifest.json'

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
  if (!normalized) throw new Error('manifest.fileName must not be empty')
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
