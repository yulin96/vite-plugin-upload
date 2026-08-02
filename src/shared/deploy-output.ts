import chalk from 'chalk'
import { formatBytes } from './progress'
import { getPanelDot, renderPanel } from './terminal'

export interface DebugTimingEntry {
  label: string
  durationMs: number
  detail?: string
  group?: string
}

export interface UploadDisplayResult {
  success: boolean
  relativeFilePath: string
  name: string
  size: number
}

const formatTimingDuration = (durationMs: number): string => {
  if (durationMs < 1000) return `${durationMs}ms`
  const seconds = durationMs / 1000
  return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`
}

export const renderDebugPanel = (entries: DebugTimingEntry[]): string => {
  const compactEntries: DebugTimingEntry[] = []
  for (const entry of entries) {
    const previousEntry = compactEntries.at(-1)
    if (entry.group && previousEntry?.group === entry.group) {
      previousEntry.durationMs += entry.durationMs
      continue
    }
    compactEntries.push({ ...entry, label: entry.group || entry.label })
  }

  const rows = compactEntries.map((entry) => ({
    label: `${entry.label}:`,
    value: chalk.cyan(
      entry.detail ? `${formatTimingDuration(entry.durationMs)} · ${entry.detail}` : formatTimingDuration(entry.durationMs),
    ),
  }))
  return renderPanel(`${getPanelDot('muted')} 调试耗时`, rows, 'muted')
}

export const printUploadedFiles = (results: UploadDisplayResult[]) => {
  const uploadedFiles = results.filter((result) => result.success)
  if (uploadedFiles.length === 0) return

  console.log(`${getPanelDot('success')} ${chalk.green.bold('上传成功文件')}`)
  uploadedFiles.forEach((result) => {
    console.log(
      `  ${chalk.green('•')} ${chalk.cyan(result.relativeFilePath)} ${chalk.gray(`· ${formatBytes(result.size)}`)} ${chalk.gray('->')} ${chalk.yellow(result.name)}`,
    )
  })
  console.log()
}
