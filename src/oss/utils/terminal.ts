import chalk from 'chalk'
import cliTruncate from 'cli-truncate'
import logSymbols from 'log-symbols'
import stringWidth from 'string-width'

export interface TerminalRow {
  label: string
  value: string
  preserveValue?: boolean
}

type PanelTone = 'info' | 'success' | 'warning' | 'danger'

const panelTitleColor: Record<PanelTone, (text: string) => string> = {
  info: chalk.cyan,
  success: chalk.green,
  warning: chalk.yellow,
  danger: chalk.red,
}

const getTerminalWidth = () => process.stdout?.columns || 100
const getPanelInnerWidth = () => Math.max(46, Math.min(84, getTerminalWidth() - 4))
const padVisual = (text: string, width: number) => `${text}${' '.repeat(Math.max(0, width - stringWidth(text)))}`
const normalizeLabel = (label: string) => label.replace(/[:：]\s*$/, '')
const fitVisual = (text: string, width: number) => {
  if (width <= 0) return ''
  return padVisual(cliTruncate(text, width, { position: 'middle' }), width)
}

export const renderPanel = (title: string, rows: TerminalRow[], tone: PanelTone = 'info', footer?: string): string => {
  const titleColor = panelTitleColor[tone]
  const innerWidth = getPanelInnerWidth()
  const labelWidth = rows.length > 0 ? Math.max(...rows.map((row) => stringWidth(normalizeLabel(row.label)))) : 0
  const contentLines: string[] = [titleColor(chalk.bold(cliTruncate(title, innerWidth, { position: 'end' })))]

  if (rows.length > 0) {
    for (const row of rows) {
      const paddedLabel = padVisual(normalizeLabel(row.label), labelWidth)
      const prefix = `  ${paddedLabel}  `
      const availableValueWidth = Math.max(8, innerWidth - stringWidth(prefix))
      const value = row.preserveValue ? row.value : fitVisual(row.value, availableValueWidth)
      contentLines.push(`${chalk.gray(prefix)}${value}`)
    }
  }

  if (footer) {
    contentLines.push('')
    contentLines.push(chalk.gray(cliTruncate(footer, innerWidth, { position: 'middle' })))
  }

  return contentLines.join('\n')
}

export const renderInlineStats = (items: Array<string | false | null | undefined>): string =>
  items.filter(Boolean).join(chalk.gray(' · '))

export const getPanelDot = (tone: PanelTone = 'success'): string => {
  switch (tone) {
    case 'info':
      return chalk.green('●')
    case 'success':
      return chalk.green('●')
    case 'warning':
      return chalk.yellow('●')
    case 'danger':
      return chalk.red('●')
  }
}

export const getLogSymbol = (tone: Exclude<PanelTone, 'info'>): string => {
  switch (tone) {
    case 'success':
      return logSymbols.success
    case 'warning':
      return logSymbols.warning
    case 'danger':
      return logSymbols.error
  }
}
