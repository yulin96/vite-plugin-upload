import chalk from 'chalk'
import { createLogUpdate } from 'log-update'
import type { Writable } from 'node:stream'
import { buildCapsuleBar, formatBytes, formatDuration } from './progress'
import { renderInlineStats } from './terminal'

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export interface UploadProgressSnapshot {
  completed: number
  totalFiles: number
  uploadedBytes: number
  totalBytes: number
  elapsedSeconds: number
  frameIndex?: number
}

export interface TerminalSpinner {
  text: string
  clear: () => void
  stop: () => void
  warn: (message: string) => void
  fail: (message: string) => void
}

export interface TerminalReporterOptions {
  fancy?: boolean
  stdout?: NodeJS.WriteStream
  stderr?: NodeJS.WriteStream
  ci?: boolean
}

export const renderUploadProgress = (snapshot: UploadProgressSnapshot, terminalWidth = 100): string => {
  const {
    completed,
    totalFiles,
    uploadedBytes,
    totalBytes,
    elapsedSeconds,
    frameIndex = 0,
  } = snapshot
  const ratio = totalFiles > 0 ? completed / totalFiles : 1
  const percentage = Math.round(Math.max(0, Math.min(1, ratio)) * 100)
  const speed = elapsedSeconds > 0 ? uploadedBytes / elapsedSeconds : 0
  const parts = [chalk.bold(`${percentage}%`)]

  if (terminalWidth >= 72) parts.push(buildCapsuleBar(ratio, terminalWidth >= 96 ? 18 : 10))
  parts.push(`${completed}/${totalFiles}`)
  if (terminalWidth >= 58) parts.push(`${formatBytes(uploadedBytes)}/${formatBytes(totalBytes)}`)
  parts.push(chalk.magenta(`${formatBytes(speed)}/s`), formatDuration(elapsedSeconds))

  return `${chalk.cyan(spinnerFrames[frameIndex % spinnerFrames.length])} ${chalk.gray('上传')} ${renderInlineStats(parts)}`
}

export class TerminalReporter {
  readonly interactive: boolean

  private readonly stdout: NodeJS.WriteStream
  private readonly live: ReturnType<typeof createLogUpdate>

  constructor(options: TerminalReporterOptions = {}) {
    this.stdout = options.stdout ?? process.stdout
    const stderr = options.stderr ?? process.stderr
    this.interactive =
      (options.fancy ?? true) && Boolean(this.stdout.isTTY) && Boolean(stderr.isTTY) && !(options.ci ?? Boolean(process.env.CI))
    this.live = createLogUpdate(this.stdout as Writable, {
      showCursor: false,
      defaultWidth: 80,
    })
  }

  update(text: string): void {
    if (this.interactive) this.live(text)
  }

  clear(): void {
    if (this.interactive) this.live.clear()
  }

  progress(snapshot: UploadProgressSnapshot): void {
    this.update(renderUploadProgress(snapshot, this.stdout.columns || 100))
  }

  spinner(initialText: string): TerminalSpinner | null {
    if (!this.interactive) return null

    let text = initialText
    let frameIndex = 0
    let active = true
    const render = () => {
      if (active) this.update(`${chalk.cyan(spinnerFrames[frameIndex % spinnerFrames.length])} ${text}`)
    }
    render()
    const timer = setInterval(() => {
      frameIndex++
      render()
    }, 80)
    timer.unref()

    const finish = (message?: string, symbol?: string) => {
      if (!active) return
      active = false
      clearInterval(timer)
      this.clear()
      if (message && symbol) console.log(`${symbol} ${message}`)
    }

    return {
      get text() {
        return text
      },
      set text(value: string) {
        text = value
        render()
      },
      clear: () => this.clear(),
      stop: () => finish(),
      warn: (message: string) => finish(message, chalk.yellow('⚠')),
      fail: (message: string) => finish(message, chalk.red('✖')),
    }
  }
}
