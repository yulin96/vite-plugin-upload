import { constants } from 'node:fs'
import { lstat, mkdir, open, stat } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { mapWithConcurrency } from '../shared/concurrency'
import type { DebugTimingEntry } from '../shared/deploy-output'
import type { ManifestPayload, UploadResult, UploadTask } from './types'
import { getFileMd5 } from './utils/file'
import { normalizeObjectKey, resolveUploadedFileUrl } from './utils/path'

const createManifestPayload = async (
  results: UploadResult[],
  configBase?: string,
  alias?: string,
  run?: string | string[],
  concurrency = 5,
): Promise<ManifestPayload> => {
  const files = await mapWithConcurrency(
    results.filter((result) => result.success),
    concurrency,
    async (result) => ({
      file: result.relativeFilePath,
      key: result.name,
      url: resolveUploadedFileUrl(result.relativeFilePath, result.name, configBase, alias),
      md5: await getFileMd5(result.file),
    }),
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
  outDir: string
  concurrency: number
  resolveOutDirFile: (relativeFilePath: string) => string
  upload: (task: UploadTask) => Promise<UploadResult>
}

export const validateManifestFilePath = async (outDir: string, filePath: string): Promise<void> => {
  let currentPath = resolve(outDir)
  for (const segment of relative(outDir, filePath).split(sep)) {
    currentPath = resolve(currentPath, segment)
    try {
      if ((await lstat(currentPath)).isSymbolicLink()) {
        throw new Error('manifest.fileName must not traverse a symbolic link inside outDir')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
      throw error
    }
  }
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

  const payload = await createManifestPayload(option.results, option.configBase, option.alias, option.run, option.concurrency)
  await validateManifestFilePath(option.outDir, filePath)
  await mkdir(dirname(filePath), { recursive: true })
  await validateManifestFilePath(option.outDir, filePath)
  const file = await open(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW)
  try {
    await file.writeFile(JSON.stringify(payload, null, 2), 'utf8')
  } finally {
    await file.close()
  }
  if (option.debug) {
    debugEntries.push({
      label: '生成清单文件',
      durationMs: Date.now() - generateStartedAt,
      detail: option.fileName,
      group: '清单处理',
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
      group: '清单处理',
    })
  }

  return {
    result,
    url: resolveUploadedFileUrl(option.fileName, objectKey, option.configBase, option.alias),
    debugEntries,
  }
}
