import { FileType, type Client } from 'basic-ftp'
import chalk from 'chalk'
import dayjs from 'dayjs'
import fs from 'node:fs'
import path from 'node:path'
import ora from 'ora'
import type { BackupSummary } from './types'
import { createTempDir, createZipFile } from './utils/file'
import { normalizeRemotePath, normalizeSelectionPath, resolveDisplayUrl } from './utils/path'
import { getPanelDot, renderPanel } from './utils/output'

const backupArchivePattern = /^backup_\d{8}_\d{6}\.zip$/i

export const renderBackupPanel = (summary: BackupSummary): string => {
  const previewItems = summary.items.slice(0, 2)
  const rows = [
    { label: '结果:', value: chalk.green(`${summary.items.length} 个备份文件`) },
    ...previewItems.map((item, index) => ({
      label: `文件 ${index + 1}:`,
      value: chalk.cyan(item),
      preserveValue: true,
    })),
  ]

  if (summary.items.length > previewItems.length) {
    rows.push({
      label: '其余:',
      value: chalk.gray(`还有 ${summary.items.length - previewItems.length} 个备份项未展开`),
    })
  }

  return renderPanel(`${getPanelDot('success')} ${summary.title}`, rows, 'success')
}

const downloadRemoteFilesForBackup = async (
  client: Client,
  remoteDir: string,
  localDir: string,
  downloadedFiles: Array<{ remotePath: string; size: number }> = [],
) => {
  if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true })
  const remoteEntries = await client.list(remoteDir)

  for (const entry of remoteEntries) {
    const remotePath = normalizeRemotePath(remoteDir, entry.name)
    const localPath = path.join(localDir, entry.name)

    if (entry.type === FileType.Directory) {
      await downloadRemoteFilesForBackup(client, remotePath, localPath, downloadedFiles)
      continue
    }
    if (entry.type === FileType.SymbolicLink || backupArchivePattern.test(entry.name)) continue
    if (entry.type === FileType.File) {
      await client.downloadTo(localPath, remotePath)
      downloadedFiles.push({ remotePath, size: entry.size })
      continue
    }

    try {
      await client.downloadTo(localPath, remotePath)
      downloadedFiles.push({ remotePath, size: entry.size })
    } catch (downloadError) {
      try {
        await downloadRemoteFilesForBackup(client, remotePath, localPath, downloadedFiles)
      } catch {
        throw downloadError
      }
    }
  }

  return downloadedFiles
}

export const createBackupFile = async (
  client: Client,
  dir: string,
  alias: string,
  showBackFile = false,
  useSpinner = true,
): Promise<BackupSummary | null> => {
  const targetUrl = resolveDisplayUrl(alias, dir)
  const backupSpinner = useSpinner ? ora(`创建备份文件中 ${chalk.yellow(`==> ${targetUrl}`)}`).start() : null
  const fileName = `backup_${dayjs().format('YYYYMMDD_HHmmss')}.zip`
  const tempDir = createTempDir('backup-download')
  const zipTempDir = createTempDir('backup-zip')
  const zipFilePath = path.join(zipTempDir.path, fileName)

  try {
    if (backupSpinner) backupSpinner.text = `下载远程文件中 ${chalk.yellow(`==> ${targetUrl}`)}`
    const downloadedFiles = await downloadRemoteFilesForBackup(client, dir, tempDir.path)

    if (downloadedFiles.length === 0) {
      backupSpinner?.warn('未找到可备份的远程文件')
      return null
    }

    if (showBackFile) {
      console.log(chalk.cyan(`\n开始备份远程文件，共 ${downloadedFiles.length} 个文件:`))
      downloadedFiles.forEach((file) => console.log(chalk.gray(`  - ${file.remotePath} (${file.size} bytes)`)))
    }

    if (backupSpinner) backupSpinner.text = `下载远程文件成功 ${chalk.yellow(`==> ${targetUrl}`)}`
    await createZipFile(tempDir.path, zipFilePath)
    const backupRemotePath = normalizeRemotePath(dir, fileName)
    if (backupSpinner) {
      backupSpinner.text = `压缩完成, 准备上传 ${chalk.yellow(`==> ${resolveDisplayUrl(alias, backupRemotePath)}`)}`
    }
    await client.uploadFrom(zipFilePath, backupRemotePath)
    backupSpinner?.stop()
    return { title: '备份完成', items: [resolveDisplayUrl(alias, backupRemotePath)] }
  } catch (error) {
    backupSpinner?.fail('备份失败')
    throw error
  } finally {
    tempDir.cleanup()
    zipTempDir.cleanup()
    try {
      if (fs.existsSync(zipFilePath)) fs.rmSync(zipFilePath)
    } catch (error) {
      console.warn(chalk.yellow('⚠ 清理zip文件失败'), error)
    }
  }
}

export const createSingleBackup = async (
  client: Client,
  dir: string,
  alias: string,
  singleBackFiles: string[],
  showBackFile = false,
  useSpinner = true,
): Promise<BackupSummary | null> => {
  const timestamp = dayjs().format('YYYYMMDD_HHmmss')
  const backupSpinner = useSpinner ? ora(`备份指定文件中 ${chalk.yellow(`==> ${resolveDisplayUrl(alias, dir)}`)}`).start() : null
  const tempDir = createTempDir('single-backup')
  let backupProgressSpinner: ReturnType<typeof ora> | undefined

  try {
    const normalizedSingleBackFiles = singleBackFiles
      .map((fileName) => normalizeSelectionPath(fileName))
      .map((fileName) => fileName.split('/').filter((segment) => segment && segment !== '.').join('/'))
      .filter((fileName) => !fileName.split('/').includes('..'))
      .filter(Boolean)
    const backupTasks = normalizedSingleBackFiles.map((fileName) => ({ fileName }))

    if (backupTasks.length === 0) {
      backupSpinner?.warn('未找到需要备份的文件')
      return null
    }

    backupSpinner?.stop()
    if (showBackFile) {
      console.log(chalk.cyan(`\n开始单文件备份，共 ${backupTasks.length} 个文件:`))
      backupTasks.forEach((task) => console.log(chalk.gray(`  - ${task.fileName}`)))
    }
    if (useSpinner) backupProgressSpinner = ora('正在备份文件...').start()

    const backedUpFiles: string[] = []
    for (const { fileName } of backupTasks) {
      try {
        const localTempPath = path.join(tempDir.path, fileName)
        const localTempDir = path.dirname(localTempPath)
        if (!fs.existsSync(localTempDir)) fs.mkdirSync(localTempDir, { recursive: true })
        const fileDir = path.posix.dirname(fileName)
        const fileBaseName = path.posix.basename(fileName)
        const extIndex = fileBaseName.lastIndexOf('.')
        const name = extIndex > -1 ? fileBaseName.slice(0, extIndex) : fileBaseName
        const ext = extIndex > -1 ? fileBaseName.slice(extIndex) : ''
        const backupFileName = `${name}.${timestamp}${ext}`
        const backupRelativePath = fileDir === '.' ? backupFileName : normalizeRemotePath(fileDir, backupFileName)
        const sourceRemotePath = normalizeRemotePath(dir, fileName)
        const backupRemotePath = normalizeRemotePath(dir, backupRelativePath)

        await client.downloadTo(localTempPath, sourceRemotePath)
        await client.uploadFrom(localTempPath, backupRemotePath)
        backedUpFiles.push(resolveDisplayUrl(alias, backupRemotePath))
      } catch (error) {
        console.warn(chalk.yellow(`备份文件 ${fileName} 失败:`), error instanceof Error ? error.message : error)
      }
    }

    if (backedUpFiles.length > 0) {
      backupProgressSpinner?.stop()
      return { title: '备份完成', items: backedUpFiles }
    }
    backupProgressSpinner?.fail('所有文件备份失败')
    return null
  } catch (error) {
    if (backupProgressSpinner) backupProgressSpinner.fail('备份过程中发生错误')
    else backupSpinner?.fail('备份过程中发生错误')
    throw error
  } finally {
    tempDir.cleanup()
  }
}
