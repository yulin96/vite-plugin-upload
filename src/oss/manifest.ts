import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DebugTimingEntry } from '../shared/deploy-output'
import type { ManifestPayload, UploadResult, UploadTask } from './types'
import { getFileMd5 } from './utils/file'
import { normalizeObjectKey, resolveUploadedFileUrl } from './utils/path'

const createManifestPayload = async (
  results: UploadResult[],
  configBase?: string,
  alias?: string,
  run?: string | string[],
): Promise<ManifestPayload> => {
  const files = await Promise.all(
    results
      .filter((result) => result.success)
      .map(async (result) => ({
        file: result.relativeFilePath,
        key: result.name,
        url: resolveUploadedFileUrl(result.relativeFilePath, result.name, configBase, alias),
        md5: await getFileMd5(result.file),
      })),
  )
  return { version: Date.now(), ...(run === undefined ? {} : { run }), files }
}

interface DeployManifestOption {
  results: UploadResult[]
  fileName: string
  run?: string | string[]
  uploadDir: string
  configBase?: string
  alias?: string
  debug: boolean
  resolveOutDirFile: (relativeFilePath: string) => string
  upload: (task: UploadTask) => Promise<UploadResult>
}

interface DeployManifestResult {
  result: UploadResult
  url: string
  debugEntries: DebugTimingEntry[]
}

export const deployOssManifest = async (option: DeployManifestOption): Promise<DeployManifestResult> => {
  const filePath = option.resolveOutDirFile(option.fileName)
  const objectKey = normalizeObjectKey(option.uploadDir, option.fileName)
  const debugEntries: DebugTimingEntry[] = []
  const generateStartedAt = Date.now()

  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    JSON.stringify(await createManifestPayload(option.results, option.configBase, option.alias, option.run), null, 2),
    'utf8',
  )
  if (option.debug) {
    debugEntries.push({
      label: '生成清单文件',
      durationMs: Date.now() - generateStartedAt,
      detail: option.fileName,
    })
  }

  const fileStats = await stat(filePath)
  const uploadStartedAt = Date.now()
  const result = await option.upload({
    filePath,
    relativeFilePath: option.fileName,
    name: objectKey,
    size: fileStats.size,
    cacheControl: 'no-cache, no-store, must-revalidate',
  })
  if (option.debug && result.success) {
    debugEntries.push({
      label: '上传清单文件',
      durationMs: Date.now() - uploadStartedAt,
      detail: option.fileName,
    })
  }

  return {
    result,
    url: resolveUploadedFileUrl(option.fileName, objectKey, option.configBase, option.alias),
    debugEntries,
  }
}
