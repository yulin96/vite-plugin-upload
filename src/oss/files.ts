import { globSync } from 'glob'
import { stat } from 'node:fs/promises'
import { normalizeSlash } from './utils/path'

export const collectOssUploadFiles = async (
  outDir: string,
  ignore: string[],
  manifestFileName: string | null,
): Promise<string[]> => {
  let outDirStats
  try {
    outDirStats = await stat(outDir)
  } catch (error) {
    throw new Error(`OSS outDir does not exist or cannot be read: ${outDir}`, { cause: error })
  }
  if (!outDirStats.isDirectory()) throw new Error(`OSS outDir is not a directory: ${outDir}`)

  let files: string[]
  try {
    files = globSync('**/*', { cwd: outDir, nodir: true, ignore })
      .map((file) => normalizeSlash(file))
      .filter((file) => file !== manifestFileName)
  } catch (error) {
    throw new Error(`Failed to scan OSS outDir: ${outDir}`, { cause: error })
  }
  if (files.length === 0) throw new Error(`OSS outDir contains no files to upload: ${outDir}`)
  return files
}
