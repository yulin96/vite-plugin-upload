import oss from 'ali-oss'
import chalk from 'chalk'
import { stat, unlink } from 'node:fs/promises'
import { isAbsolute, sep as pathSeparator, relative, resolve } from 'node:path'
import { printUploadedFiles, renderDebugPanel, type DebugTimingEntry } from '../shared/deploy-output'
import { TerminalReporter } from '../shared/terminal-reporter'
import { collectOssUploadFiles } from './files'
import { deployOssManifest } from './manifest'
import type { DeployOssOption, DeployOssResult, UploadResult, UploadTask } from './types'
import { removeEmptyDirectories } from './utils/file'
import {
  ensureTrailingSlash,
  normalizeObjectKey,
  normalizePathSegments,
  normalizeSlash,
  normalizeUrlLikeBase,
  resolveManifestFileName,
} from './utils/path'
import { formatBytes, formatDuration } from './utils/progress'
import { getLogSymbol, getPanelDot, renderInlineStats, renderPanel } from './utils/terminal'

interface UploadBatchExecution {
  results: UploadResult[]
  debugEntries: DebugTimingEntry[]
}

const validateOptions = (
  option: DeployOssOption,
  runtimeOption: Pick<Required<DeployOssOption>, 'retryTimes' | 'concurrency' | 'multipartThreshold'>,
): string[] => {
  const errors: string[] = []
  if (!option.accessKeyId) errors.push('accessKeyId is required')
  if (!option.accessKeySecret) errors.push('accessKeySecret is required')
  if (!option.bucket) errors.push('bucket is required')
  if (!option.region) errors.push('region is required')
  if (!option.uploadDir) errors.push('uploadDir is required')
  if (!Number.isInteger(runtimeOption.retryTimes) || runtimeOption.retryTimes < 1)
    errors.push('retryTimes must be >= 1')
  if (!Number.isInteger(runtimeOption.concurrency) || runtimeOption.concurrency < 1) {
    errors.push('concurrency must be >= 1')
  }
  if (!Number.isFinite(runtimeOption.multipartThreshold) || runtimeOption.multipartThreshold <= 0) {
    errors.push('multipartThreshold must be > 0')
  }
  try {
    resolveManifestFileName(option.manifest)
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  return errors
}

export const deployOss = async (option: DeployOssOption): Promise<DeployOssResult> => {
  const rawOption = option || ({} as DeployOssOption)
  const {
    accessKeyId,
    accessKeySecret,
    region,
    bucket,
    configBase,
    skip = '**/index.html',
    uploadDir,
    overwrite = true,
    secure = true,
    autoDelete = false,
    alias,
    open = true,
    debug = false,
    fancy = true,
    showUploadedFiles = false,
    noCache = false,
    failOnError = true,
    concurrency = 5,
    retryTimes = 3,
    multipartThreshold = 10 * 1024 * 1024,
    manifest = false,
    outDir = 'dist',
    ...props
  } = rawOption

  if (!open) {
    return {
      success: true,
      results: [],
      outDir: normalizeSlash(resolve(outDir)),
      durationSeconds: 0,
      uploadedBytes: 0,
      retryCount: 0,
    }
  }

  const validationErrors = validateOptions(rawOption, {
    retryTimes,
    concurrency,
    multipartThreshold,
  })
  if (validationErrors.length > 0) {
    throw new Error(`vite-plugin-deploy-oss 配置错误:\n${validationErrors.map((err) => `  - ${err}`).join('\n')}`)
  }

  const normalizedUploadDir = normalizePathSegments(uploadDir)
  const normalizedConfigBase = configBase ? ensureTrailingSlash(normalizeUrlLikeBase(configBase)) : undefined
  const normalizedAlias = alias ? normalizeUrlLikeBase(alias) : undefined
  const manifestFileName = resolveManifestFileName(manifest)
  const manifestRun = typeof manifest === 'object' ? manifest.run : undefined
  const effectiveAutoDelete = manifestFileName ? false : autoDelete
  const effectiveSkip =
    manifestFileName ? []
    : Array.isArray(skip) ? skip
    : [skip]
  const resolvedOutDir = normalizeSlash(resolve(outDir))
  const resolveOutDirFile = (relativeFilePath: string): string => {
    const resolvedFilePath = resolve(resolvedOutDir, relativeFilePath)
    const relativeToOutDir = relative(resolvedOutDir, resolvedFilePath)

    if (
      !relativeToOutDir ||
      relativeToOutDir === '..' ||
      relativeToOutDir.startsWith(`..${pathSeparator}`) ||
      isAbsolute(relativeToOutDir)
    ) {
      throw new Error(`Path must resolve inside outDir: ${relativeFilePath}`)
    }

    return normalizeSlash(resolvedFilePath)
  }
  const reporter = new TerminalReporter({ fancy })
  const useInteractiveOutput = reporter.interactive

  const uploadFileWithRetry = async (
    client: oss,
    task: UploadTask,
    silentLogs: boolean,
    maxRetries: number = retryTimes,
  ): Promise<UploadResult> => {
    const shouldUseMultipart = task.size >= multipartThreshold
    const headers = {
      'x-oss-storage-class': 'Standard',
      'x-oss-object-acl': 'default',
      'Cache-Control':
        task.cacheControl || (noCache || task.name.endsWith('.html') ? 'no-cache' : 'public, max-age=86400, immutable'),
      'x-oss-forbid-overwrite': overwrite ? 'false' : 'true',
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result =
          shouldUseMultipart ?
            await client.multipartUpload(task.name, task.filePath, {
              timeout: 600000,
              partSize: 1024 * 1024,
              parallel: Math.max(1, Math.min(concurrency, 4)),
              headers,
            })
          : await client.put(task.name, task.filePath, {
              timeout: 600000,
              headers,
            })

        if (result.res.status === 200) {
          if (effectiveAutoDelete) {
            try {
              await unlink(task.filePath)
            } catch {
              console.warn(`${getLogSymbol('warning')} 删除本地文件失败: ${task.relativeFilePath}`)
            }
          }

          return {
            success: true,
            file: task.filePath,
            relativeFilePath: task.relativeFilePath,
            name: task.name,
            size: task.size,
            retries: attempt - 1,
          }
        }

        throw new Error(`Upload failed with status: ${result.res.status}`)
      } catch (error) {
        if (attempt === maxRetries) {
          if (!silentLogs) {
            const reason = error instanceof Error ? error.message : String(error)
            console.log(`${getLogSymbol('danger')} ${task.relativeFilePath}  ${reason}`)
          }
          return {
            success: false,
            file: task.filePath,
            relativeFilePath: task.relativeFilePath,
            name: task.name,
            size: task.size,
            retries: attempt - 1,
            error: error as Error,
          }
        }

        if (!silentLogs) {
          console.log(`${getLogSymbol('warning')} ${task.relativeFilePath}  正在重试 (${attempt}/${maxRetries})`)
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000 * attempt))
      }
    }

    return {
      success: false,
      file: task.filePath,
      relativeFilePath: task.relativeFilePath,
      name: task.name,
      size: task.size,
      retries: maxRetries,
      error: new Error('Max retries exceeded'),
    }
  }

  const uploadSingleTask = async (client: oss, task: UploadTask): Promise<UploadResult> =>
    uploadFileWithRetry(client, task, false)

  const uploadFilesInBatches = async (
    client: oss,
    files: string[],
    windowSize: number = concurrency,
  ): Promise<UploadBatchExecution> => {
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
        const filePath = resolveOutDirFile(relativeFilePath)
        const name = normalizeObjectKey(normalizedUploadDir, relativeFilePath)

        try {
          const fileStats = await stat(filePath)
          return { task: { filePath, relativeFilePath, name, size: fileStats.size } as UploadTask }
        } catch (error) {
          return { task: null, error: error as Error, filePath, relativeFilePath, name }
        }
      }),
    )
    debugEntries.push({
      label: '生成上传任务',
      durationMs: Date.now() - taskPrepareStartedAt,
      detail: `${files.length} 个文件`,
      group: '前置操作',
    })

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
          name: candidate.name,
          size: 0,
          retries: 0,
          error: candidate.error,
        })
      }
    }

    const totalBytes = tasks.reduce((sum, task) => sum + task.size, 0)
    const startAt = Date.now()
    const safeWindowSize = Math.max(1, Math.min(windowSize, tasks.length || 1))
    const silentLogs = Boolean(useInteractiveOutput)
    let spinnerFrameIndex = 0
    const reportEvery = Math.max(1, Math.ceil(totalFiles / 6))
    let lastReportedCompleted = -1

    const updateProgress = () => {
      const elapsedSeconds = (Date.now() - startAt) / 1000
      const speed = elapsedSeconds > 0 ? uploadedBytes / elapsedSeconds : 0

      if (!reporter.interactive) {
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
      } else {
        reporter.progress({
          completed,
          totalFiles,
          uploadedBytes,
          totalBytes,
          elapsedSeconds,
          frameIndex: spinnerFrameIndex,
        })
      }
    }

    const refreshTimer =
      reporter.interactive ?
        setInterval(() => {
          spinnerFrameIndex = (spinnerFrameIndex + 1) % 10
          updateProgress()
        }, 120)
      : null
    let currentIndex = 0

    const worker = async () => {
      while (true) {
        const index = currentIndex++
        if (index >= tasks.length) return

        const task = tasks[index]
        updateProgress()

        const result = await uploadFileWithRetry(client, task, silentLogs)
        completed++
        retries += result.retries
        if (result.success) {
          uploadedBytes += result.size
        } else {
          failed++
        }
        results.push(result)
        updateProgress()
      }
    }

    updateProgress()

    try {
      await Promise.all(Array.from({ length: safeWindowSize }, () => worker()))
    } finally {
      if (refreshTimer) clearInterval(refreshTimer)
    }

    if (reporter.interactive) {
      const elapsedSeconds = (Date.now() - startAt) / 1000
      reporter.progress({
        completed,
        totalFiles,
        uploadedBytes,
        totalBytes,
        elapsedSeconds,
        frameIndex: spinnerFrameIndex,
      })
      reporter.clear()
    } else if (failed > 0) {
      console.log(`${getLogSymbol('warning')} 文件上传结束，成功 ${completed - failed}/${totalFiles}，失败 ${failed}`)
    } else {
      console.log(`${getLogSymbol('success')} 所有文件上传完成 (${totalFiles}/${totalFiles})`)
    }

    debugEntries.push({
      label: '上传文件',
      durationMs: Date.now() - startAt,
      detail: `${tasks.length} 个成功候选 · 并发 ${safeWindowSize}`,
    })

    return { results, debugEntries }
  }

  const startTime = Date.now()
  const debugEntries: DebugTimingEntry[] = []
  const localOutputFailure = (error: Error): DeployOssResult => {
    console.log(`${getLogSymbol('danger')} ${error.message}`)
    if (!showUploadedFiles) console.log()
    if (failOnError) throw error

    return {
      success: false,
      results: [],
      outDir: resolvedOutDir,
      durationSeconds: (Date.now() - startTime) / 1000,
      uploadedBytes: 0,
      retryCount: 0,
    }
  }

  const collectFilesStartedAt = Date.now()
  let files: string[]
  try {
    files = await collectOssUploadFiles(resolvedOutDir, effectiveSkip, manifestFileName)
  } catch (error) {
    return localOutputFailure(error instanceof Error ? error : new Error(String(error)))
  }
  debugEntries.push({
    label: '扫描本地文件',
    durationMs: Date.now() - collectFilesStartedAt,
    detail: `${files.length} 个文件`,
    group: '前置操作',
  })

  const client = new oss({ region, accessKeyId, accessKeySecret, secure, bucket, ...props })

  console.log()
  console.log(
    renderPanel(
      `${getPanelDot('info')} 准备部署`,
      [
        { label: '位置:', value: chalk.green(`${bucket} · ${region}`) },
        {
          label: '目标:',
          value: chalk.yellow(
            normalizedAlias ? `${normalizedUploadDir || '/'} · ${normalizedAlias}` : normalizedUploadDir || '/',
          ),
          preserveValue: true,
        },
        {
          label: '文件:',
          value: chalk.blue(`${files.length} 个 · ${resolvedOutDir}`),
          preserveValue: true,
        },
        {
          label: '策略:',
          value: renderInlineStats([
            `并发 ${concurrency}`,
            `覆盖 ${overwrite ? '允许' : '禁止'}`,
            manifestFileName ? `清单 ${manifestFileName}` : '清单关闭',
            `最多尝试 ${retryTimes} 次`,
          ]),
        },
      ],
      'info',
    ),
  )

  let completedResults: UploadResult[] = []

  try {
    const uploadExecution = await uploadFilesInBatches(client, files, concurrency)
    const { results, debugEntries: uploadDebugEntries } = uploadExecution
    completedResults = results
    if (debug) {
      debugEntries.push(...uploadDebugEntries)
    }

    const uploadedFileFailedCount = results.filter((result) => !result.success).length
    let manifestSummary: string | null = null
    let manifestUrl: string | undefined
    let finalResults = results

    if (uploadedFileFailedCount > 0 && failOnError) {
      if (showUploadedFiles) {
        printUploadedFiles(results)
      }
      throw new Error(`Failed to upload ${uploadedFileFailedCount} of ${results.length} files`)
    }

    if (manifestFileName && uploadedFileFailedCount === 0) {
      const manifestDeployment = await deployOssManifest({
        results,
        fileName: manifestFileName,
        run: manifestRun,
        uploadDir: normalizedUploadDir,
        configBase: normalizedConfigBase,
        alias: normalizedAlias,
        debug,
        resolveOutDirFile,
        upload: (task) => uploadSingleTask(client, task),
      })
      finalResults = [...results, manifestDeployment.result]
      completedResults = finalResults
      if (debug) debugEntries.push(...manifestDeployment.debugEntries)
      if (!manifestDeployment.result.success) {
        throw manifestDeployment.result.error || new Error(`Failed to upload manifest: ${manifestFileName}`)
      }
      manifestUrl = manifestDeployment.url
      manifestSummary = manifestDeployment.url
    } else if (manifestFileName && uploadedFileFailedCount > 0) {
      console.warn(`${getLogSymbol('warning')} 有文件上传失败，已跳过清单文件`)
    }

    const successCount = finalResults.filter((result) => result.success).length
    const failedCount = finalResults.length - successCount
    const durationSeconds = (Date.now() - startTime) / 1000
    const uploadedBytes = finalResults.reduce((sum, result) => (result.success ? sum + result.size : sum), 0)
    const retryCount = finalResults.reduce((sum, result) => sum + result.retries, 0)
    const avgSpeed = durationSeconds > 0 ? uploadedBytes / durationSeconds : 0

    if (effectiveAutoDelete) {
      try {
        const cleanupStartedAt = Date.now()
        await removeEmptyDirectories(resolvedOutDir)
        if (debug) {
          debugEntries.push({
            label: '清理空目录',
            durationMs: Date.now() - cleanupStartedAt,
          })
        }
      } catch (error) {
        console.warn(`${getLogSymbol('warning')} 清理空目录失败: ${error}`)
      }
    }

    const resultRows = [
      {
        label: '结果:',
        value:
          failedCount === 0 ?
            chalk.green(
              manifestSummary ?
                `${results.length} 个产物 + 1 个清单 · 全部成功`
              : `${successCount}/${finalResults.length} 全部成功`,
            )
          : chalk.yellow(`成功 ${successCount} 个，失败 ${failedCount} 个`),
      },
      {
        label: '统计:',
        value: renderInlineStats([
          `${retryCount} 次重试`,
          formatBytes(uploadedBytes),
          `平均速度 ${formatBytes(avgSpeed)}/s`,
          formatDuration(durationSeconds),
        ]),
      },
      ...(manifestSummary ? [{ label: '清单:', value: chalk.cyan(manifestSummary), preserveValue: true }] : []),
    ]

    if (failedCount > 0) {
      const failedItems = finalResults.filter((result) => !result.success).slice(0, 2)
      resultRows.push(
        ...failedItems.map((item, index) => ({
          label: `失败 ${index + 1}`,
          value: chalk.red(`${item.name} · ${item.error?.message || 'unknown error'}`),
          preserveValue: true,
        })),
      )
      if (failedCount > failedItems.length) {
        resultRows.push({
          label: '其余',
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
      printUploadedFiles(finalResults)
    }

    if (debug) {
      debugEntries.push({
        label: '总耗时',
        durationMs: Date.now() - startTime,
      })
      console.log(renderDebugPanel(debugEntries))
    }

    if (!showUploadedFiles) console.log()
    return {
      success: failedCount === 0,
      results: finalResults,
      outDir: resolvedOutDir,
      durationSeconds,
      uploadedBytes,
      retryCount,
      manifestUrl,
    }
  } catch (error) {
    console.log(`\n${getLogSymbol('danger')} 上传过程中发生错误: ${error}\n`)
    if (debug && debugEntries.length > 0) {
      debugEntries.push({
        label: '失败前耗时',
        durationMs: Date.now() - startTime,
      })
      console.log(renderDebugPanel(debugEntries))
    }
    if (failOnError) {
      console.log()
      throw error instanceof Error ? error : new Error(String(error))
    }

    if (showUploadedFiles) {
      printUploadedFiles(completedResults)
    }

    const uploadedBytes = completedResults.reduce((sum, result) => (result.success ? sum + result.size : sum), 0)
    const retryCount = completedResults.reduce((sum, result) => sum + result.retries, 0)

    console.log()
    return {
      success: false,
      results: completedResults,
      outDir: resolvedOutDir,
      durationSeconds: (Date.now() - startTime) / 1000,
      uploadedBytes,
      retryCount,
    }
  }
}
