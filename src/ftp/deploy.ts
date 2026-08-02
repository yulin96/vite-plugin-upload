import { checkbox, select } from '@inquirer/prompts'
import { Client } from 'basic-ftp'
import chalk from 'chalk'
import cliProgress from 'cli-progress'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import ora from 'ora'
import { printUploadedFiles, renderDebugPanel, type DebugTimingEntry } from '../shared/deploy-output'
import type {
  BackupSummary,
  DeployFtpOption,
  DeployFtpResult,
  DeployTargetResult,
  FtpConfig,
  FtpConnectConfig,
  UploadResult,
  UploadTask,
} from './types'
import { createBackupFile, createSingleBackup, renderBackupPanel } from './backup'
import { getFtpUploadFiles } from './utils/file'
import { connectWithRetry, sleep, validateFtpConfig } from './utils/ftp'
import { getLogSymbol, getPanelDot, renderInlineStats, renderPanel, type TerminalRow } from './utils/output'
import {
  normalizeFtpUploadPath,
  normalizeRemotePath,
  normalizeSlash,
  normalizeUrlLikeBase,
  resolveDisplayUrl,
} from './utils/path'
import { formatBytes, formatDuration } from './utils/progress'

interface UploadDebugMetrics {
  connectMs: number
  rootDirMs: number
  switchDirMs: number
  uploadMs: number
}

interface UploadBatchExecution {
  results: UploadResult[]
  debugEntries: DebugTimingEntry[]
}

interface ReusableUploadClient {
  client: Client
}

export const deployFtp = async (option: DeployFtpOption): Promise<DeployFtpResult> => {
  const safeOption = (option || {}) as DeployFtpOption
  const {
    open = true,
    outDir: optionOutDir = 'dist',
    uploadPath = '',
    singleBack = false,
    singleBackFiles = ['index.html'],
    showBackFile = false,
    showUploadedFiles = false,
    debug = false,
    maxRetries = 3,
    retryDelay = 1000,
    autoUpload = false,
    fancy = true,
    failOnError = true,
    concurrency = 8,
  } = safeOption

  const isMultiFtp = 'ftps' in safeOption
  const ftpConfigs: FtpConfig[] =
    isMultiFtp ?
      safeOption.ftps || []
    : [{ ...safeOption, name: safeOption.name || safeOption.alias || safeOption.host }]
  const defaultFtp = isMultiFtp ? safeOption.defaultFtp : undefined
  const uploadPaths = Array.isArray(uploadPath) ? uploadPath : [uploadPath]
  const normalizedUploadPaths = Array.from(
    new Set(
      uploadPaths.map((targetPath) => (typeof targetPath === 'string' ? normalizeFtpUploadPath(targetPath) : '/')),
    ),
  )

  const outDir = normalizeSlash(path.resolve(optionOutDir))

  const useInteractiveOutput =
    fancy && Boolean(process.stdout?.isTTY) && Boolean(process.stderr?.isTTY) && !process.env.CI

  const clearScreen = () => {
    if (!useInteractiveOutput) return
    process.stdout.write('\x1b[2J\x1b[0f')
  }

  if (!open) {
    return {
      success: true,
      targets: [],
      outDir,
      totalFiles: 0,
      failedCount: 0,
    }
  }

  const validateOptions = (): string[] => {
    const errors: string[] = []

    if (uploadPaths.length === 0) {
      errors.push('uploadPath is required')
    }

    uploadPaths.forEach((targetPath, index) => {
      if (typeof targetPath !== 'string' || targetPath.trim() === '') {
        errors.push(`uploadPath${uploadPaths.length > 1 ? `[${index}]` : ''} is required`)
      }
    })
    if (!Number.isInteger(maxRetries) || maxRetries < 1) errors.push('maxRetries must be >= 1')
    if (!Number.isFinite(retryDelay) || retryDelay < 0) errors.push('retryDelay must be >= 0')
    if (!Number.isInteger(concurrency) || concurrency < 1) errors.push('concurrency must be >= 1')

    if (isMultiFtp) {
      if (!ftpConfigs.length) {
        errors.push('ftps is required and must not be empty')
      }

      if (defaultFtp && !ftpConfigs.some((ftp) => ftp.name === defaultFtp)) {
        errors.push(`defaultFtp "${defaultFtp}" does not match any ftp.name`)
      }

      const validConfigCount = ftpConfigs.filter(validateFtpConfig).length
      if (validConfigCount === 0) {
        errors.push('at least one ftp config requires host, user and password')
      }
    } else {
      const singleConfig = ftpConfigs[0]
      if (!singleConfig?.host) errors.push('host is required')
      if (!singleConfig?.user) errors.push('user is required')
      if (!singleConfig?.password) errors.push('password is required')
    }

    return errors
  }

  const uploadFileWithRetry = async (
    task: UploadTask,
    context: {
      client: Client
      ensureConnected: () => Promise<void>
      ensureRemoteDir: (remoteDir: string) => Promise<void>
      markDisconnected: () => void
      silentLogs: boolean
      maxRetries: number
      retryDelay: number
      debugMetrics?: UploadDebugMetrics
    },
  ): Promise<UploadResult> => {
    for (let attempt = 1; attempt <= context.maxRetries; attempt++) {
      try {
        await context.ensureConnected()

        const remoteDir = normalizeSlash(path.posix.dirname(task.remotePath))
        if (remoteDir && remoteDir !== '.') {
          await context.ensureRemoteDir(remoteDir)
        }

        const uploadStartedAt = Date.now()
        await context.client.uploadFrom(task.filePath, path.posix.basename(task.remotePath))
        if (context.debugMetrics) {
          context.debugMetrics.uploadMs += Date.now() - uploadStartedAt
        }
        return {
          success: true,
          file: task.filePath,
          relativeFilePath: task.relativeFilePath,
          name: task.remotePath,
          size: task.size,
          retries: attempt - 1,
        }
      } catch (error) {
        context.markDisconnected()
        try {
          context.client.close()
        } catch {
          // ignore close errors
        }

        if (attempt === context.maxRetries) {
          if (!context.silentLogs) {
            console.log(
              `${chalk.red('✗')} ${task.filePath} => ${error instanceof Error ? error.message : String(error)}`,
            )
          }

          return {
            success: false,
            file: task.filePath,
            relativeFilePath: task.relativeFilePath,
            name: task.remotePath,
            size: task.size,
            retries: attempt - 1,
            error: error as Error,
          }
        }

        if (!context.silentLogs) {
          console.log(`${chalk.yellow('⚠')} ${task.filePath} 上传失败，正在重试 (${attempt}/${context.maxRetries})...`)
        }
        await sleep(context.retryDelay * attempt)
      }
    }

    return {
      success: false,
      file: task.filePath,
      relativeFilePath: task.relativeFilePath,
      name: task.remotePath,
      size: task.size,
      retries: context.maxRetries,
      error: new Error('Max retries exceeded'),
    }
  }

  const uploadFilesInBatches = async (context: {
    connectConfig: FtpConnectConfig
    files: string[]
    targetDir: string
    windowSize?: number
    reusableClient?: ReusableUploadClient
  }): Promise<UploadBatchExecution> => {
    const { connectConfig, files, targetDir, windowSize = concurrency, reusableClient } = context
    const results: UploadResult[] = []
    const debugEntries: DebugTimingEntry[] = []
    const totalFiles = files.length
    const tasks: UploadTask[] = []

    let completed = 0
    let failed = 0
    let uploadedBytes = 0
    let retries = 0

    const taskPrepareStartedAt = Date.now()
    const taskCandidates = await Promise.all(
      files.map(async (relativeFilePath) => {
        const filePath = normalizeSlash(path.resolve(outDir, relativeFilePath))
        const remotePath = normalizeRemotePath(targetDir, relativeFilePath)

        try {
          const fileStats = await stat(filePath)
          return { task: { filePath, relativeFilePath, remotePath, size: fileStats.size } as UploadTask }
        } catch (error) {
          return { task: null, error: error as Error, filePath, relativeFilePath, remotePath }
        }
      }),
    )

    for (const candidate of taskCandidates) {
      if (candidate.task) {
        tasks.push(candidate.task)
      } else {
        failed++
        completed++
        results.push({
          success: false,
          file: candidate.filePath,
          relativeFilePath: candidate.relativeFilePath,
          name: candidate.remotePath,
          size: 0,
          retries: 0,
          error: candidate.error,
        })
      }
    }

    debugEntries.push({
      label: '生成上传任务',
      durationMs: Date.now() - taskPrepareStartedAt,
      detail: `${tasks.length} 个文件`,
    })

    const normalizedTargetDir = normalizeFtpUploadPath(targetDir)
    tasks.sort((left, right) => left.remotePath.localeCompare(right.remotePath))

    const totalBytes = tasks.reduce((sum, task) => sum + task.size, 0)
    const startAt = Date.now()
    const safeWindowSize = Math.max(1, Math.min(windowSize, tasks.length || 1))
    const silentLogs = Boolean(useInteractiveOutput)
    const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    let spinnerFrameIndex = 0
    const progressBar =
      useInteractiveOutput ?
        new cliProgress.SingleBar({
          hideCursor: true,
          clearOnComplete: true,
          stopOnComplete: true,
          barsize: 18,
          barCompleteChar: '█',
          barIncompleteChar: '░',
          format: `${chalk.cyan('{spinner}')} ${chalk.gray('上传')} ${chalk.bold('{percentage}%')} ${chalk.cyan('{bar}')} ${chalk.gray('·')} ${chalk.magenta('{speed}/s')} ${chalk.gray('·')} ${chalk.gray('{elapsed}')}s`,
        })
      : null
    const reportEvery = Math.max(1, Math.ceil(totalFiles / 6))
    let lastReportedCompleted = -1
    const debugMetrics: UploadDebugMetrics = {
      connectMs: 0,
      rootDirMs: 0,
      switchDirMs: 0,
      uploadMs: 0,
    }

    if (progressBar) {
      progressBar.start(totalFiles, 0, {
        spinner: spinnerFrames[spinnerFrameIndex],
        speed: formatBytes(0),
        elapsed: '0',
      })
    }

    const updateProgress = () => {
      const elapsedSeconds = (Date.now() - startAt) / 1000
      const speed = elapsedSeconds > 0 ? uploadedBytes / elapsedSeconds : 0

      if (!progressBar) {
        const progressRatio = totalFiles > 0 ? completed / totalFiles : 1
        const percentage = Math.round(progressRatio * 100)
        if (completed === 0 && totalFiles > 0) return
        if (completed === lastReportedCompleted) return
        if (completed === totalFiles || completed % reportEvery === 0) {
          console.log(
            `${chalk.gray('上传进度')} ${renderInlineStats([
              chalk.bold(`${completed}/${totalFiles}`),
              `${percentage}%`,
              `${formatBytes(uploadedBytes)}/${formatBytes(totalBytes)}`,
              `${formatBytes(speed)}/s`,
            ])}`,
          )
          lastReportedCompleted = completed
        }
        return
      }

      progressBar.update(completed, {
        spinner: spinnerFrames[spinnerFrameIndex],
        speed: chalk.magenta(formatBytes(speed)),
        elapsed: formatDuration(elapsedSeconds).replace(/s$/, ''),
      })
    }

    const refreshTimer =
      progressBar ?
        setInterval(() => {
          spinnerFrameIndex = (spinnerFrameIndex + 1) % spinnerFrames.length
          updateProgress()
        }, 120)
      : null
    let currentTaskIndex = 0

    const runWorker = async (seed?: ReusableUploadClient) => {
      const client = seed?.client ?? new Client()
      const ownsClient = !seed
      let connected = Boolean(seed)
      let currentRelativeDir = ''
      let rooted = false
      const ensuredRelativeDirs = new Set<string>()

      const ensureConnected = async () => {
        if (connected) return
        const connectStartedAt = Date.now()
        await connectWithRetry(client, connectConfig, maxRetries, retryDelay, true)
        connected = true
        rooted = false
        currentRelativeDir = ''
        debugMetrics.connectMs += Date.now() - connectStartedAt
      }

      const ensureRootDir = async () => {
        if (rooted) return
        const rootStartedAt = Date.now()
        await client.ensureDir(normalizedTargetDir)
        rooted = true
        currentRelativeDir = ''
        debugMetrics.rootDirMs += Date.now() - rootStartedAt
      }

      const ensureRemoteDir = async (remoteDir: string) => {
        await ensureRootDir()
        const relativeDir =
          remoteDir === normalizedTargetDir ? '' : remoteDir.slice(normalizedTargetDir.length).replace(/^\/+/, '')
        if (currentRelativeDir === relativeDir) return

        const switchStartedAt = Date.now()
        await client.cd(normalizedTargetDir)
        if (relativeDir) {
          if (!ensuredRelativeDirs.has(relativeDir)) {
            await client.ensureDir(relativeDir)
            ensuredRelativeDirs.add(relativeDir)
          } else {
            await client.cd(relativeDir)
          }
        }
        currentRelativeDir = relativeDir
        debugMetrics.switchDirMs += Date.now() - switchStartedAt
      }

      const markDisconnected = () => {
        connected = false
        rooted = false
        currentRelativeDir = ''
        ensuredRelativeDirs.clear()
      }

      try {
        while (true) {
          const taskIndex = currentTaskIndex++
          if (taskIndex >= tasks.length) return
          const task = tasks[taskIndex]
          updateProgress()

          const result = await uploadFileWithRetry(task, {
            client,
            ensureConnected,
            ensureRemoteDir,
            markDisconnected,
            silentLogs,
            maxRetries,
            retryDelay,
            debugMetrics,
          })

          completed++
          retries += result.retries
          if (result.success) uploadedBytes += result.size
          else failed++
          results.push(result)
          updateProgress()
        }
      } finally {
        if (ownsClient) client.close()
      }
    }

    updateProgress()

    try {
      const newClientWorkerCount = reusableClient ? safeWindowSize - 1 : safeWindowSize
      const workers = Array.from({ length: newClientWorkerCount }, () => runWorker())
      if (reusableClient) workers.push(runWorker(reusableClient))
      await Promise.all(workers)
    } finally {
      if (refreshTimer) clearInterval(refreshTimer)
    }

    if (progressBar) {
      const elapsedSeconds = (Date.now() - startAt) / 1000
      const speed = elapsedSeconds > 0 ? uploadedBytes / elapsedSeconds : 0
      progressBar.update(totalFiles, {
        spinner: spinnerFrames[spinnerFrameIndex],
        speed: chalk.magenta(formatBytes(speed)),
        elapsed: formatDuration(elapsedSeconds).replace(/s$/, ''),
      })
      progressBar.stop()
    } else if (failed > 0) {
      console.log(`${getLogSymbol('warning')} 文件上传结束，成功 ${completed - failed}/${totalFiles}，失败 ${failed}`)
    } else {
      console.log(`${getLogSymbol('success')} 文件上传完成 (${totalFiles}/${totalFiles})`)
    }

    debugEntries.push(
      {
        label: '连接服务器',
        durationMs: debugMetrics.connectMs,
      },
      {
        label: '准备根目录',
        durationMs: debugMetrics.rootDirMs,
      },
      {
        label: '切换子目录',
        durationMs: debugMetrics.switchDirMs,
      },
      {
        label: '传输累计',
        durationMs: debugMetrics.uploadMs,
        detail: `${tasks.length} 个文件 · ${safeWindowSize} 路并发`,
      },
      {
        label: '上传阶段',
        durationMs: Date.now() - startAt,
      },
    )

    return { results, debugEntries }
  }

  const deploySingleTarget = async (
    ftpConfig: FtpConfig,
    normalizedUploadPath: string,
  ): Promise<DeployTargetResult> => {
    const { host, port = 21, user, password, alias = '', name, secure, secureOptions } = ftpConfig
    const normalizedAlias = alias ? normalizeUrlLikeBase(alias) : ''

    if (!host || !user || !password) {
      console.error(chalk.red(`❌ FTP配置 "${name || host || '未知'}" 缺少必需参数:`))
      if (!host) console.error(chalk.red('  - 缺少 host'))
      if (!user) console.error(chalk.red('  - 缺少 user'))
      if (!password) console.error(chalk.red('  - 缺少 password'))
      return { name: name || host || 'unknown', totalFiles: 0, failedCount: 1 }
    }

    const displayName = name || host
    const resultName = normalizedUploadPaths.length > 1 ? `${displayName} ${normalizedUploadPath}` : displayName
    const startTime = Date.now()
    const debugEntries: DebugTimingEntry[] = []
    const collectFilesStartedAt = Date.now()
    let allFiles: string[]
    try {
      allFiles = getFtpUploadFiles(outDir)
    } catch (error) {
      const scanError = error instanceof Error ? error : new Error(String(error))
      console.log(`${getLogSymbol('danger')} ${scanError.message}`)
      return { name: resultName, totalFiles: 0, failedCount: 1, error: scanError }
    }
    debugEntries.push({
      label: '扫描本地文件',
      durationMs: Date.now() - collectFilesStartedAt,
      detail: `${allFiles.length} 个文件`,
    })
    const totalFiles = allFiles.length

    clearScreen()
    console.log(
      renderPanel(
        `${getPanelDot('success')} 准备部署`,
        [
          {
            label: '位置:',
            value: chalk.green(`${displayName} · ${port === 21 ? host : `${host}:${port}`}`),
          },
          {
            label: '目标:',
            value: chalk.yellow(
              normalizedAlias ? `${normalizedUploadPath} · ${normalizedAlias}` : normalizedUploadPath,
            ),
            preserveValue: true,
          },
          {
            label: '文件:',
            value: chalk.blue(`${totalFiles} 个 · ${outDir}`),
            preserveValue: true,
          },
        ],
        'info',
      ),
    )

    const connectConfig: FtpConnectConfig = { host, port, user, password, secure, secureOptions }
    const preflightClient = new Client()
    const preflightSpinner = useInteractiveOutput ? ora(`连接到 ${displayName}...`).start() : null

    try {
      const preflightConnectStartedAt = Date.now()
      await connectWithRetry(preflightClient, connectConfig, maxRetries, retryDelay, Boolean(preflightSpinner))
      debugEntries.push({
        label: '预检连接',
        durationMs: Date.now() - preflightConnectStartedAt,
      })
      if (preflightSpinner) preflightSpinner.stop()

      const ensureTargetStartedAt = Date.now()
      await preflightClient.ensureDir(normalizedUploadPath)
      debugEntries.push({
        label: '确认目标目录',
        durationMs: Date.now() - ensureTargetStartedAt,
        detail: normalizedUploadPath,
      })

      const listRemoteStartedAt = Date.now()
      const fileList = await preflightClient.list()
      debugEntries.push({
        label: '读取远端文件',
        durationMs: Date.now() - listRemoteStartedAt,
        detail: `${fileList.length} 个`,
      })
      let backupSummary: BackupSummary | null = null

      if (fileList.length) {
        if (singleBack) {
          const backupStartedAt = Date.now()
          backupSummary = await createSingleBackup(
            preflightClient,
            normalizedUploadPath,
            normalizedAlias,
            singleBackFiles,
            showBackFile,
            useInteractiveOutput,
          )
          debugEntries.push({
            label: '执行备份',
            durationMs: Date.now() - backupStartedAt,
            detail: backupSummary ? `${backupSummary.items.length} 个备份文件` : '未生成备份',
          })
        } else {
          const shouldBackup = await select({
            message: `是否备份 ${displayName} 的远程文件`,
            choices: ['否', '是'],
            default: '否',
          })

          if (shouldBackup === '是') {
            const backupStartedAt = Date.now()
            backupSummary = await createBackupFile(
              preflightClient,
              normalizedUploadPath,
              normalizedAlias,
              showBackFile,
              useInteractiveOutput,
            )
            debugEntries.push({
              label: '执行备份',
              durationMs: Date.now() - backupStartedAt,
              detail: backupSummary ? `${backupSummary.items.length} 个备份文件` : '未生成备份',
            })
          } else if (debug) {
            debugEntries.push({
              label: '执行备份',
              durationMs: 0,
              detail: '手动跳过',
            })
          }
        }
      } else if (debug) {
        debugEntries.push({
          label: '执行备份',
          durationMs: 0,
          detail: '远端为空，跳过',
        })
      }

      if (backupSummary) {
        console.log(renderBackupPanel(backupSummary))
      }

      const uploadExecution = await uploadFilesInBatches({
        connectConfig,
        files: allFiles,
        targetDir: normalizedUploadPath,
        windowSize: concurrency,
        reusableClient: { client: preflightClient },
      })
      const { results, debugEntries: uploadDebugEntries } = uploadExecution
      if (debug) {
        debugEntries.push(...uploadDebugEntries)
      }

      const successCount = results.filter((r) => r.success).length
      const failedCount = results.length - successCount
      const durationSeconds = (Date.now() - startTime) / 1000
      const uploadedBytes = results.reduce((sum, result) => (result.success ? sum + result.size : sum), 0)
      const retryCount = results.reduce((sum, result) => sum + result.retries, 0)
      const avgSpeed = durationSeconds > 0 ? uploadedBytes / durationSeconds : 0
      const accessUrl = normalizedAlias ? resolveDisplayUrl(normalizedAlias, normalizedUploadPath) : ''

      clearScreen()
      const resultRows: TerminalRow[] = [
        {
          label: '结果:',
          value:
            failedCount === 0 ?
              chalk.green(`${successCount}/${results.length} 全部成功`)
            : chalk.yellow(`成功 ${successCount} 个，失败 ${failedCount} 个`),
        },
        {
          label: '统计:',
          value: renderInlineStats([
            `${retryCount} 次重试`,
            formatBytes(uploadedBytes),
            `${formatBytes(avgSpeed)}/s`,
            formatDuration(durationSeconds),
          ]),
        },
      ]
      if (accessUrl) {
        resultRows.push({ label: '访问:', value: chalk.cyan(accessUrl), preserveValue: true })
      }

      if (failedCount > 0) {
        const failedItems = results.filter((result) => !result.success).slice(0, 2)
        resultRows.push(
          ...failedItems.map((item, index) => ({
            label: `失败 ${index + 1}:`,
            value: chalk.red(`${item.name} · ${item.error?.message || 'unknown error'}`),
            preserveValue: true,
          })),
        )
        if (failedCount > failedItems.length) {
          resultRows.push({
            label: '其余:',
            value: chalk.gray(`还有 ${failedCount - failedItems.length} 个失败项未展开`),
          })
        }
      }

      console.log(
        renderPanel(
          failedCount === 0 ? `${getPanelDot('success')} 部署完成` : `${getPanelDot('warning')} 部署完成`,
          resultRows,
          failedCount === 0 ? 'success' : 'warning',
        ),
      )

      if (showUploadedFiles) {
        printUploadedFiles(results)
      }

      if (debug) {
        debugEntries.push({
          label: '总耗时',
          durationMs: Date.now() - startTime,
        })
        console.log(renderDebugPanel(debugEntries))
      }

      return { name: resultName, totalFiles: results.length, failedCount }
    } catch (error) {
      if (preflightSpinner) preflightSpinner.stop()

      console.log(`\n${getLogSymbol('danger')} 上传过程中发生错误: ${error}\n`)
      if (debug && debugEntries.length > 0) {
        debugEntries.push({
          label: '失败前耗时',
          durationMs: Date.now() - startTime,
        })
        console.log(renderDebugPanel(debugEntries))
      }
      return {
        name: resultName,
        totalFiles,
        failedCount: totalFiles > 0 ? totalFiles : 1,
        error: error instanceof Error ? error : new Error(String(error)),
      }
    } finally {
      preflightClient.close()
    }
  }

  const deployToFtp = async (): Promise<DeployTargetResult[]> => {
    if (!autoUpload) {
      console.log()
      const ftpUploadChoice = await select({
        message: '是否上传FTP',
        choices: ['是', '否'],
        default: '是',
      })
      if (ftpUploadChoice === '否') return []
    }

    let selectedConfigs: FtpConfig[] = []

    if (isMultiFtp) {
      if (defaultFtp) {
        const defaultConfig = ftpConfigs.find((ftp) => ftp.name === defaultFtp)
        if (defaultConfig && validateFtpConfig(defaultConfig)) {
          console.log(chalk.blue(`使用默认FTP配置: ${defaultFtp}`))
          selectedConfigs = [defaultConfig]
        } else if (defaultConfig) {
          console.log(chalk.yellow(`⚠ 默认FTP配置 "${defaultFtp}" 缺少必需参数，将进行手动选择`))
        }
      }

      if (selectedConfigs.length === 0) {
        const validConfigs = ftpConfigs.filter(validateFtpConfig)
        const invalidConfigs = ftpConfigs.filter((config) => !validateFtpConfig(config))

        if (invalidConfigs.length > 0) {
          console.log(chalk.yellow('\n以下FTP配置缺少必需参数，已从选择列表中排除:'))
          invalidConfigs.forEach((config) => {
            const missing = []
            if (!config.host) missing.push('host')
            if (!config.user) missing.push('user')
            if (!config.password) missing.push('password')
            console.log(chalk.yellow(`  - ${config.name || '未命名'}: 缺少 ${missing.join(', ')}`))
          })
          console.log()
        }

        if (validConfigs.length === 0) {
          console.error(chalk.red('❌ 没有可用的有效FTP配置'))
          return []
        }

        selectedConfigs = (await checkbox({
          message: '选择要上传的FTP服务器（可多选）',
          choices: validConfigs.map((ftp) => ({
            name: ftp.name || ftp.host || '未命名FTP',
            value: ftp,
          })),
          required: true,
        })) as FtpConfig[]
      }
    } else {
      const singleConfig = ftpConfigs[0] as FtpConfig
      if (validateFtpConfig(singleConfig)) {
        selectedConfigs = [{ ...singleConfig, name: singleConfig.name || singleConfig.host }]
      } else {
        const missing = []
        if (!singleConfig?.host) missing.push('host')
        if (!singleConfig?.user) missing.push('user')
        if (!singleConfig?.password) missing.push('password')
        console.error(chalk.red(`❌ FTP配置缺少必需参数: ${missing.join(', ')}`))
        return []
      }
    }

    const deployResults: DeployTargetResult[] = []

    for (const ftpConfig of selectedConfigs) {
      for (const normalizedUploadPath of normalizedUploadPaths) {
        const targetResult = await deploySingleTarget(ftpConfig, normalizedUploadPath)
        deployResults.push(targetResult)
      }
    }

    return deployResults
  }

  clearScreen()

  const validationErrors = validateOptions()
  if (validationErrors.length > 0) {
    throw new Error(`配置错误:\n${validationErrors.map((err) => `  - ${err}`).join('\n')}`)
  }

  let localOutputError: Error | undefined
  try {
    getFtpUploadFiles(outDir)
  } catch (error) {
    localOutputError = error instanceof Error ? error : new Error(String(error))
  }

  if (localOutputError) {
    console.log(`${getLogSymbol('danger')} ${localOutputError.message}`)
    if (failOnError) throw localOutputError

    return {
      success: false,
      targets: [
        {
          name: 'local output',
          totalFiles: 0,
          failedCount: 1,
          error: localOutputError,
        },
      ],
      outDir,
      totalFiles: 0,
      failedCount: 1,
    }
  }

  const deployResults = await deployToFtp()
  const failedTargets = deployResults.filter((target) => target.failedCount > 0)
  const totalFiles = deployResults.reduce((sum, target) => sum + target.totalFiles, 0)
  const failedCount = deployResults.reduce((sum, target) => sum + target.failedCount, 0)

  if (failedTargets.length > 0 && failOnError) {
    console.log()
    throw new Error(`Failed to deploy ${failedTargets.length} of ${deployResults.length} FTP targets`)
  }

  if (!showUploadedFiles) console.log()
  return {
    success: failedTargets.length === 0,
    targets: deployResults,
    outDir,
    totalFiles,
    failedCount,
  }
}
