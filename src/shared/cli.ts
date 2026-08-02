import { access, readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const readCliValue = (args: string[], index: number, name: string): string => {
  const value = args[index + 1]
  if (!value || value.startsWith('-')) throw new Error(`${name} requires a value`)
  return value
}

export const appendCliValue = (current: string | string[] | undefined, value: string): string | string[] => {
  if (Array.isArray(current)) return [...current, value]
  return current ? [current, value] : value
}

const findDefaultConfig = async (defaultConfigFiles: string[]): Promise<string | undefined> => {
  for (const file of defaultConfigFiles) {
    const filePath = resolve(file)
    try {
      await access(filePath)
      return filePath
    } catch {}
  }
}

export const loadDeployConfig = async <T extends object>(
  configPath: string | undefined,
  defaultConfigFiles: string[],
  namedExport: string,
): Promise<Partial<T>> => {
  const resolvedConfigPath = configPath ? resolve(configPath) : await findDefaultConfig(defaultConfigFiles)
  if (!resolvedConfigPath) return {}

  if (extname(resolvedConfigPath) === '.json') {
    return JSON.parse(await readFile(resolvedConfigPath, 'utf8')) as Partial<T>
  }

  const mod = (await import(pathToFileURL(resolvedConfigPath).href)) as Record<string, unknown>
  return (mod.default || mod[namedExport] || {}) as Partial<T>
}
