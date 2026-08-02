import { normalizePathSegments, normalizeUrlLikeBase } from '../../shared/path'

export { normalizePathSegments, normalizeSlash, normalizeUrlLikeBase } from '../../shared/path'

export const normalizeFtpUploadPath = (targetPath: string): string => {
  const normalized = normalizePathSegments(targetPath)
  return normalized ? `/${normalized}` : '/'
}

export const normalizeRemotePath = (targetDir: string, relativeFilePath: string): string => {
  const normalizedTargetDir = normalizeFtpUploadPath(targetDir)
  const normalizedRelativePath = normalizePathSegments(relativeFilePath)
  if (!normalizedRelativePath) return normalizedTargetDir
  if (normalizedTargetDir === '/') return `/${normalizedRelativePath}`
  return `${normalizedTargetDir}/${normalizedRelativePath}`
}

export const normalizeSelectionPath = (value: string): string => normalizePathSegments(value)

export const joinUrlLikePath = (base: string, targetPath: string): string => {
  const normalizedBase = normalizeUrlLikeBase(base).replace(/\/+$/, '')
  const normalizedTargetPath = normalizePathSegments(targetPath)
  if (!normalizedTargetPath) return normalizedBase
  if (!normalizedBase) return `/${normalizedTargetPath}`
  return `${normalizedBase}/${normalizedTargetPath}`
}

export const resolveDisplayUrl = (alias: string | undefined, targetPath: string): string => {
  const normalizedTargetPath = normalizeFtpUploadPath(targetPath)
  if (!alias) return normalizedTargetPath
  return joinUrlLikePath(alias, normalizedTargetPath)
}
