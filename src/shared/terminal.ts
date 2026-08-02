import chalk from 'chalk'
import cliTruncate from 'cli-truncate'
import logSymbols from 'log-symbols'
import stringWidth from 'string-width'
import wrapAnsi from 'wrap-ansi'

export interface TerminalRow {
  label: string
  value: string
  preserveValue?: boolean
}

type PanelTone = 'info' | 'success' | 'muted' | 'warning' | 'danger'

const panelTitleColor: Record<PanelTone, (text: string) => string> = {
  info: chalk.cyan,
  success: chalk.green,
  muted: chalk.gray,
  warning: chalk.yellow,
  danger: chalk.red,
}

const getTerminalWidth = () => process.stdout?.columns || 100
const getPanelInnerWidth = (terminalWidth = getTerminalWidth()) => Math.max(20, Math.min(84, terminalWidth - 2))
const padVisual = (text: string, width: number) => `${text}${' '.repeat(Math.max(0, width - stringWidth(text)))}`
const normalizeLabel = (label: string) => label.replace(/[:：]\s*$/, '')
const fitVisual = (text: string, width: number) => {
  if (width <= 0) return ''
  return cliTruncate(text, width, { position: 'middle' })
}

export const renderPanel = (
  title: string,
  rows: TerminalRow[],
  tone: PanelTone = 'info',
  footer?: string,
  terminalWidth?: number,
): string => {
  const titleColor = panelTitleColor[tone]
  const innerWidth = getPanelInnerWidth(terminalWidth)
  const labelWidth = rows.length > 0 ? Math.max(...rows.map((row) => stringWidth(normalizeLabel(row.label)))) : 0
  const contentLines: string[] = [titleColor(chalk.bold(cliTruncate(title, innerWidth, { position: 'end' })))]

  for (const row of rows) {
    const paddedLabel = padVisual(normalizeLabel(row.label), labelWidth)
    const prefix = `  ${paddedLabel}  `
    const availableValueWidth = Math.max(8, innerWidth - stringWidth(prefix))
    if (row.preserveValue) {
      const wrappedLines = wrapAnsi(row.value, availableValueWidth, {
        hard: true,
        trim: false,
        wordWrap: false,
      }).split('\n')
      contentLines.push(`${chalk.gray(prefix)}${wrappedLines[0] || ''}`)
      contentLines.push(...wrappedLines.slice(1).map((line) => `${' '.repeat(stringWidth(prefix))}${line}`))
    } else {
      contentLines.push(`${chalk.gray(prefix)}${fitVisual(row.value, availableValueWidth)}`)
    }
  }

  if (footer) {
    contentLines.push('', chalk.gray(cliTruncate(footer, innerWidth, { position: 'middle' })))
  }
  return contentLines.join('\n')
}

export const renderInlineStats = (items: Array<string | false | null | undefined>): string =>
  items.filter(Boolean).join(chalk.gray(' · '))

export const getPanelDot = (tone: PanelTone = 'success'): string => {
  switch (tone) {
    case 'info':
      return chalk.cyan('●')
    case 'success':
      return chalk.green('●')
    case 'muted':
      return chalk.gray('●')
    case 'warning':
      return chalk.yellow('●')
    case 'danger':
      return chalk.red('●')
  }
}

export const getLogSymbol = (tone: 'success' | 'warning' | 'danger'): string => {
  switch (tone) {
    case 'success':
      return logSymbols.success
    case 'warning':
      return logSymbols.warning
    case 'danger':
      return logSymbols.error
  }
}
