import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { beforeEach, expect, test, vi } from 'vitest'
import { vitePluginUpload } from '../src/index'
import { createUploadFixture } from './helpers/upload'

const remote = vi.hoisted(() => ({ put: vi.fn(), uploadFrom: vi.fn() }))
vi.mock('ali-oss', () => ({ default: class { put = remote.put } }))
vi.mock('basic-ftp', () => ({
  FileType: { File: 1, Directory: 2, SymbolicLink: 3 },
  Client: class {
    ftp = { verbose: false }
    async access() {}
    async ensureDir() {}
    async cd() {}
    async list() { return [] }
    uploadFrom = remote.uploadFrom
    close() {}
  },
}))
vi.mock('@inquirer/prompts', () => ({ select: vi.fn(() => '否'), checkbox: vi.fn() }))

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  remote.put.mockReset().mockResolvedValue({ res: { status: 200 } })
  remote.uploadFrom.mockReset().mockResolvedValue(undefined)
})

const createPlugins = (autoUpload = true) => vitePluginUpload({
  oss: { accessKeyId: 'id', accessKeySecret: 'secret', bucket: 'bucket', region: 'oss-cn-hangzhou', uploadDir: 'assets', open: true, autoDelete: true, retryTimes: 1, fancy: false },
  ftp: { host: 'example.com', user: 'user', password: 'password', uploadPath: '/site', open: true, autoUpload, concurrency: 1, maxRetries: 1, retryDelay: 0, fancy: false, failOnError: false },
})

const hook = <T extends (...args: never[]) => unknown>(value: T | { handler: T } | undefined): T => {
  if (!value) throw new Error('Missing hook')
  return typeof value === 'function' ? value : value.handler
}
const configure = (plugins: Plugin[], outDir: string) => {
  for (const plugin of plugins) {
    hook(plugin.config).call({} as never, {}, { command: 'build', mode: 'production' })
    hook(plugin.configResolved).call({} as never, { root: outDir, build: { outDir: '.' } } as never)
  }
}

test('defers OSS autoDelete until FTP has uploaded the same assets successfully', async () => {
  const { outDir } = createUploadFixture({ 'a.js': 'asset', 'index.html': 'entry' })
  const plugins = createPlugins()
  configure(plugins, outDir)
  await hook(plugins[0].closeBundle).call({} as never)
  expect(readFileSync(join(outDir, 'a.js'), 'utf8')).toBe('asset')
  remote.uploadFrom.mockImplementation(async (file: string) => expect(readFileSync(file, 'utf8')).toBe(file.endsWith('a.js') ? 'asset' : 'entry'))
  await hook(plugins[1].closeBundle).call({} as never)
  expect(remote.put.mock.calls.map(([name]) => name)).toEqual(['assets/a.js'])
  expect(remote.uploadFrom.mock.calls).toEqual([[join(outDir, 'a.js'), 'a.js'], [join(outDir, 'index.html'), 'index.html']])
  expect(existsSync(join(outDir, 'a.js'))).toBe(false)
  expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toBe('entry')
})

test('retains local OSS assets when FTP fails even with failOnError=false', async () => {
  const { outDir } = createUploadFixture({ 'a.js': 'asset', 'index.html': 'entry' })
  const plugins = createPlugins()
  configure(plugins, outDir)
  remote.uploadFrom.mockRejectedValue(new Error('FTP transfer rejected'))
  for (const plugin of plugins) await hook(plugin.closeBundle).call({} as never)
  expect(remote.uploadFrom.mock.calls.map(([, name]) => name)).toEqual(['a.js'])
  expect(readFileSync(join(outDir, 'a.js'), 'utf8')).toBe('asset')
  expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toBe('entry')
})

test('retains local OSS assets when interactive FTP upload is cancelled', async () => {
  const { outDir } = createUploadFixture({ 'a.js': 'asset', 'index.html': 'entry' })
  const plugins = createPlugins(false)
  configure(plugins, outDir)
  for (const plugin of plugins) await hook(plugin.closeBundle).call({} as never)
  expect(remote.put.mock.calls.map(([name]) => name)).toEqual(['assets/a.js'])
  expect(remote.uploadFrom).not.toHaveBeenCalled()
  expect(readFileSync(join(outDir, 'a.js'), 'utf8')).toBe('asset')
})
