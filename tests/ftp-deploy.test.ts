import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test, vi } from 'vitest'
import { deployFtp } from '../src/ftp/deploy'

test('rejects an empty FTP outDir before connecting and respects failOnError', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  const option = {
    open: true,
    host: 'example.com',
    user: 'user',
    password: 'password',
    uploadPath: '/assets',
    outDir,
    autoUpload: true,
    fancy: false,
  } as const
  vi.spyOn(console, 'log').mockImplementation(() => {})

  try {
    await expect(deployFtp(option)).rejects.toThrow('FTP outDir contains no files to upload')
    const result = await deployFtp({ ...option, failOnError: false })
    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        outDir,
        totalFiles: 0,
        failedCount: 1,
      }),
    )
    expect(ftpMock.constructor).not.toHaveBeenCalled()
    expect(result.targets).toEqual([
      expect.objectContaining({ name: 'local output', totalFiles: 0, failedCount: 1 }),
    ])
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})


const ftpMock = vi.hoisted(() => ({
  access: vi.fn(), ensureDir: vi.fn(), cd: vi.fn(), list: vi.fn(), uploadFrom: vi.fn(), close: vi.fn(),
  constructor: vi.fn(),
}))
vi.mock('basic-ftp', () => ({
  Client: class {
    constructor() { ftpMock.constructor() }
    ftp = { verbose: false }
    access = ftpMock.access
    ensureDir = ftpMock.ensureDir
    cd = ftpMock.cd
    list = ftpMock.list
    uploadFrom = ftpMock.uploadFrom
    close = ftpMock.close
  },
}))
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(() => { throw new Error('Unexpected interactive prompt') }),
  checkbox: vi.fn(() => { throw new Error('Unexpected interactive prompt') }),
}))

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  ftpMock.access.mockReset().mockResolvedValue(undefined)
  ftpMock.ensureDir.mockReset().mockResolvedValue(undefined)
  ftpMock.cd.mockReset().mockResolvedValue(undefined)
  ftpMock.list.mockReset().mockResolvedValue([])
  ftpMock.uploadFrom.mockReset().mockResolvedValue(undefined)
})

const deploymentOptions = {
  host: 'example.com', user: 'user', password: 'password', uploadPath: '/assets',
  autoUpload: true, fancy: false, concurrency: 1, maxRetries: 1, retryDelay: 0,
}

test('deduplicates normalized targets and preserves nested remote directories', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  mkdirSync(join(outDir, 'nested'))
  writeFileSync(join(outDir, 'nested/a.js'), 'a')
  try {
    const result = await deployFtp({ ...deploymentOptions, outDir, uploadPath: ['/assets/', 'assets', '/other'] })
    expect(result).toMatchObject({ success: true, totalFiles: 2, failedCount: 0 })
    expect(result.targets).toHaveLength(2)
    expect(ftpMock.uploadFrom).toHaveBeenCalledTimes(2)
    expect(ftpMock.uploadFrom).toHaveBeenCalledWith(join(outDir, 'nested/a.js'), 'a.js')
    expect(ftpMock.ensureDir).toHaveBeenCalledWith('/assets')
    expect(ftpMock.ensureDir).toHaveBeenCalledWith('/other')
    expect(ftpMock.ensureDir).toHaveBeenCalledWith('nested')
    expect(ftpMock.constructor).toHaveBeenCalledTimes(2)
    expect(ftpMock.close).toHaveBeenCalledTimes(2)
  } finally { rmSync(outDir, { recursive: true, force: true }) }
})

test.each([true, false])('closes a failed preflight connection with failOnError=%s', async (failOnError) => {
  const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  writeFileSync(join(outDir, 'a.js'), 'a')
  ftpMock.access.mockRejectedValue(new Error('connection refused'))
  try {
    const deployment = deployFtp({ ...deploymentOptions, outDir, failOnError })
    if (failOnError) await expect(deployment).rejects.toThrow('Failed to deploy 1 of 1 FTP targets')
    else await expect(deployment).resolves.toMatchObject({ success: false, totalFiles: 1, failedCount: 1 })
    expect(ftpMock.uploadFrom).not.toHaveBeenCalled()
    expect(ftpMock.close).toHaveBeenCalledTimes(1)
  } finally { rmSync(outDir, { recursive: true, force: true }) }
})

test('reconnects and prepares the directory again after an upload failure', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  writeFileSync(join(outDir, 'a.js'), 'a')
  ftpMock.uploadFrom.mockRejectedValueOnce(new Error('connection reset')).mockResolvedValue(undefined)
  try {
    const result = await deployFtp({ ...deploymentOptions, outDir, maxRetries: 2 })
    expect(result).toMatchObject({ success: true, totalFiles: 1, failedCount: 0 })
    expect(ftpMock.access).toHaveBeenCalledTimes(2)
    expect(ftpMock.uploadFrom).toHaveBeenCalledTimes(2)
    expect(ftpMock.ensureDir).toHaveBeenCalledTimes(3)
    expect(ftpMock.close).toHaveBeenCalledTimes(2)
  } finally { rmSync(outDir, { recursive: true, force: true }) }
})
