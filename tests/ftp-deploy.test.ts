import fs from 'node:fs'
import { join } from 'node:path'
import { beforeEach, expect, test, vi } from 'vitest'
import { deployFtp } from '../src/ftp/deploy'
import { createUploadFixture, deferred } from './helpers/upload'

const ftpMock = vi.hoisted(() => ({
  access: vi.fn(), ensureDir: vi.fn(), cd: vi.fn(), list: vi.fn(), uploadFrom: vi.fn(), downloadTo: vi.fn(), close: vi.fn(),
  constructor: vi.fn(), select: vi.fn(), checkbox: vi.fn(),
}))
vi.mock('basic-ftp', () => ({
  FileType: { File: 1, Directory: 2, SymbolicLink: 3 },
  Client: class {
    constructor() { ftpMock.constructor() }
    ftp = { verbose: false }
    access(...args: unknown[]) { return ftpMock.access.apply(this, args) }
    ensureDir(...args: unknown[]) { return ftpMock.ensureDir.apply(this, args) }
    cd(...args: unknown[]) { return ftpMock.cd.apply(this, args) }
    list(...args: unknown[]) { return ftpMock.list.apply(this, args) }
    uploadFrom(...args: unknown[]) { return ftpMock.uploadFrom.apply(this, args) }
    downloadTo(...args: unknown[]) { return ftpMock.downloadTo.apply(this, args) }
    close() { ftpMock.close.call(this) }
  },
}))
vi.mock('@inquirer/prompts', () => ({ select: ftpMock.select, checkbox: ftpMock.checkbox }))

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  for (const fn of Object.values(ftpMock)) fn.mockReset()
  ftpMock.access.mockResolvedValue(undefined)
  ftpMock.ensureDir.mockResolvedValue(undefined)
  ftpMock.cd.mockResolvedValue(undefined)
  ftpMock.list.mockResolvedValue([])
  ftpMock.uploadFrom.mockResolvedValue(undefined)
  ftpMock.select.mockRejectedValue(new Error('Unexpected interactive prompt'))
  ftpMock.checkbox.mockRejectedValue(new Error('Unexpected interactive prompt'))
})

const deploymentOptions = {
  host: 'example.com', user: 'user', password: 'password', uploadPath: '/assets',
  autoUpload: true, fancy: false, concurrency: 1, maxRetries: 1, retryDelay: 0,
}

test('rejects an empty FTP outDir before connecting and respects failOnError', async () => {
  const { outDir } = createUploadFixture()
  await expect(deployFtp({ ...deploymentOptions, outDir })).rejects.toThrow('FTP outDir contains no files to upload')
  const result = await deployFtp({ ...deploymentOptions, outDir, failOnError: false })
  expect(result).toMatchObject({ success: false, outDir, totalFiles: 0, failedCount: 1 })
  expect(result.targets).toEqual([expect.objectContaining({ name: 'local output', totalFiles: 0, failedCount: 1 })])
  expect(ftpMock.constructor).not.toHaveBeenCalled()
})

test('deduplicates normalized targets and scans local files once across targets', async () => {
  const { outDir } = createUploadFixture({ 'nested/a.js': 'a' })
  const scan = vi.spyOn(fs, 'readdirSync')
  const result = await deployFtp({ ...deploymentOptions, outDir, uploadPath: ['/assets/', 'assets', '/other'] })
  expect(result).toMatchObject({ success: true, totalFiles: 2, failedCount: 0 })
  expect(result.targets.map((target) => target.name)).toEqual(['example.com /assets', 'example.com /other'])
  expect(ftpMock.uploadFrom.mock.calls).toEqual([[join(outDir, 'nested/a.js'), 'a.js'], [join(outDir, 'nested/a.js'), 'a.js']])
  expect(ftpMock.ensureDir).toHaveBeenCalledWith('/assets')
  expect(ftpMock.ensureDir).toHaveBeenCalledWith('/other')
  expect(ftpMock.ensureDir).toHaveBeenCalledWith('nested')
  expect(scan.mock.calls.filter(([dir]) => dir === outDir)).toHaveLength(1)
  expect(ftpMock.constructor).toHaveBeenCalledTimes(2)
  expect(ftpMock.close).toHaveBeenCalledTimes(2)
})

test.each([true, false])('closes a failed preflight connection with failOnError=%s', async (failOnError) => {
  const { outDir } = createUploadFixture({ 'a.js': 'a' })
  ftpMock.access.mockRejectedValue(new Error('connection refused'))
  const deployment = deployFtp({ ...deploymentOptions, outDir, failOnError })
  if (failOnError) await expect(deployment).rejects.toThrow('Failed to deploy 1 of 1 FTP targets')
  else await expect(deployment).resolves.toMatchObject({ success: false, totalFiles: 1, failedCount: 1 })
  expect(ftpMock.uploadFrom).not.toHaveBeenCalled()
  expect(ftpMock.close).toHaveBeenCalledTimes(1)
})

test('reconnects after upload failure and re-enters the target directory', async () => {
  const { outDir } = createUploadFixture({ 'a.js': 'a' })
  ftpMock.uploadFrom.mockRejectedValueOnce(new Error('connection reset')).mockResolvedValue(undefined)
  const result = await deployFtp({ ...deploymentOptions, outDir, maxRetries: 2 })
  expect(result).toMatchObject({ success: true, totalFiles: 1, failedCount: 0 })
  expect(ftpMock.access).toHaveBeenCalledTimes(2)
  expect(ftpMock.uploadFrom).toHaveBeenCalledTimes(2)
  expect(ftpMock.cd).toHaveBeenCalledWith('/assets')
  expect(ftpMock.ensureDir.mock.calls).toEqual([['/assets']])
  expect(ftpMock.close).toHaveBeenCalledTimes(2)
})

test('does not multiply connection retries inside file retries', async () => {
  const { outDir } = createUploadFixture({ 'a.js': 'a' })
  ftpMock.access.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('reconnection refused'))
  ftpMock.uploadFrom.mockRejectedValueOnce(new Error('transfer reset'))
  const result = await deployFtp({ ...deploymentOptions, outDir, maxRetries: 3, failOnError: false })
  expect(result).toMatchObject({ success: false, totalFiles: 1, failedCount: 1 })
  expect(ftpMock.access).toHaveBeenCalledTimes(3)
  expect(ftpMock.uploadFrom).toHaveBeenCalledTimes(1)
})

test('autoUpload does not prompt for backups when remote files exist', async () => {
  const { outDir } = createUploadFixture({ 'index.html': 'new html' })
  ftpMock.list.mockResolvedValue([{ name: 'index.html', type: 1, size: 3 }])
  expect((await deployFtp({ ...deploymentOptions, outDir })).success).toBe(true)
  expect(ftpMock.select).not.toHaveBeenCalled()
  expect(ftpMock.checkbox).not.toHaveBeenCalled()
  expect(ftpMock.uploadFrom).toHaveBeenCalledExactlyOnceWith(join(outDir, 'index.html'), 'index.html')
})

test.each([true, false])('backup failures prevent overwriting application files with failOnError=%s', async (failOnError) => {
  const { outDir } = createUploadFixture({ 'index.html': 'new html' })
  ftpMock.list.mockResolvedValue([{ name: 'index.html', type: 1, size: 3 }])
  ftpMock.downloadTo.mockRejectedValue(new Error('permission denied'))
  const deployment = deployFtp({ ...deploymentOptions, outDir, singleBack: true, failOnError })
  if (failOnError) await expect(deployment).rejects.toThrow('Failed to deploy')
  else expect(await deployment).toMatchObject({ success: false, failedCount: 1 })
  expect(ftpMock.downloadTo).toHaveBeenCalledTimes(1)
  expect(ftpMock.uploadFrom).not.toHaveBeenCalled()
  expect(fs.readFileSync(join(outDir, 'index.html'), 'utf8')).toBe('new html')
  expect(ftpMock.close).toHaveBeenCalledTimes(1)
})

test('cancelling interactive upload creates no remote connection', async () => {
  const { outDir } = createUploadFixture({ 'a.js': 'a' })
  ftpMock.select.mockResolvedValue('否')
  const result = await deployFtp({ ...deploymentOptions, outDir, autoUpload: false })
  expect(result).toMatchObject({ success: true, targets: [], totalFiles: 0 })
  expect(ftpMock.constructor).not.toHaveBeenCalled()
  expect(ftpMock.uploadFrom).not.toHaveBeenCalled()
})

test('unattended multiple-server deployment requires an explicit target', async () => {
  const { outDir } = createUploadFixture({ 'a.js': 'a' })
  await expect(deployFtp({ ...deploymentOptions, outDir, ftps: [
    { name: 'one', host: 'one.example', user: 'user', password: 'password' },
    { name: 'two', host: 'two.example', user: 'user', password: 'password' },
  ] })).rejects.toThrow(/defaultFtp/)
  expect(ftpMock.checkbox).not.toHaveBeenCalled()
  expect(ftpMock.access).not.toHaveBeenCalled()
})

test.each([true, false])('does not publish HTML when an asset fails with failOnError=%s', async (failOnError) => {
  const { outDir } = createUploadFixture({ 'index.html': 'html', 'a.js': 'a' })
  ftpMock.uploadFrom.mockRejectedValue(new Error('transfer rejected'))
  const deployment = deployFtp({ ...deploymentOptions, outDir, failOnError })
  if (failOnError) await expect(deployment).rejects.toThrow('Failed to deploy')
  else expect((await deployment).success).toBe(false)
  expect(ftpMock.uploadFrom.mock.calls).toEqual([[join(outDir, 'a.js'), 'a.js']])
})

test('bounds concurrency per connection and publishes HTML only after all assets finish', async () => {
  const { outDir } = createUploadFixture({ 'a.js': 'a', 'b.js': 'b', 'c.js': 'c', 'index.html': 'html' })
  const fullWindow = deferred()
  const release = deferred()
  const activeClients = new Set<unknown>()
  let peak = 0
  ftpMock.uploadFrom.mockImplementation(async function (this: unknown, _file: string, name: string) {
    expect(activeClients.has(this)).toBe(false)
    activeClients.add(this)
    peak = Math.max(peak, activeClients.size)
    if (activeClients.size === 2) fullWindow.resolve()
    if (name.endsWith('.js')) await release.promise
    activeClients.delete(this)
  })
  const deployment = deployFtp({ ...deploymentOptions, outDir, concurrency: 2 })
  await fullWindow.promise
  try {
    expect(ftpMock.uploadFrom).toHaveBeenCalledTimes(2)
    expect(ftpMock.uploadFrom.mock.calls.some(([, name]) => name === 'index.html')).toBe(false)
  } finally { release.resolve() }
  expect(await deployment).toMatchObject({ success: true, totalFiles: 4, failedCount: 0 })
  expect(peak).toBe(2)
  expect(ftpMock.uploadFrom.mock.calls.at(-1)).toEqual([join(outDir, 'index.html'), 'index.html'])
  expect(ftpMock.uploadFrom.mock.calls.map(([, name]) => name).sort()).toEqual(['a.js', 'b.js', 'c.js', 'index.html'])
  expect(ftpMock.close).toHaveBeenCalledTimes(2)
})
