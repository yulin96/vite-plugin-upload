import { unlink } from 'node:fs/promises'
import type { DeployOssResult } from './types'
import { removeEmptyDirectories } from './utils/file'
import { getLogSymbol } from './utils/terminal'

export const cleanupOssUploads = async (deployment: DeployOssResult): Promise<void> => {
  for (const result of deployment.results) {
    if (!result.success) continue
    try {
      await unlink(result.file)
    } catch {
      console.warn(`${getLogSymbol('warning')} 删除本地文件失败: ${result.relativeFilePath}`)
    }
  }
  try {
    await removeEmptyDirectories(deployment.outDir)
  } catch (error) {
    console.warn(`${getLogSymbol('warning')} 清理空目录失败: ${error}`)
  }
}
