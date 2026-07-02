import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { afterEach, expect, test, vi } from 'vitest'
import { vitePluginUpload } from '../src'
import vitePluginDeployFtp from '../src/ftp'
import vitePluginDeployOss, { deployOss } from '../src/oss'

const ossMock = vi.hoisted(() => ({
  put: vi.fn(),
  multipartUpload: vi.fn(),
}))

vi.mock('ali-oss', () => ({
  default: class {
    put = ossMock.put
    multipartUpload = ossMock.multipartUpload
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

test('creates upload plugins from enabled targets', () => {
  const plugins = vitePluginUpload({
    oss: {
      accessKeyId: 'id',
      accessKeySecret: 'secret',
      bucket: 'bucket',
      region: 'oss-cn-hangzhou',
      uploadDir: 'dist',
      open: false,
    },
    ftp: {
      host: 'example.com',
      user: 'user',
      password: 'password',
      uploadPath: '/dist',
      open: false,
    },
  })

  expect(plugins.map((plugin) => plugin.name)).toEqual(['vite-plugin-deploy-oss', 'vite-plugin-deploy-ftp'])
})

test('keeps upload plugins closed by default', () => {
  const config = { base: '/' }
  const ftpPlugin = vitePluginDeployFtp({
    host: 'example.com',
    user: 'user',
    password: 'password',
    uploadPath: '/dist',
  }) as Plugin
  const ossPlugin = vitePluginDeployOss({
    accessKeyId: 'id',
    accessKeySecret: 'secret',
    bucket: 'bucket',
    region: 'oss-cn-hangzhou',
    uploadDir: 'dist',
    configBase: 'https://example.com/assets',
  }) as Plugin

  expect(typeof ftpPlugin.config === 'function' ? ftpPlugin.config(config, { command: 'build', mode: 'production' }) : null)
    .toBeUndefined()
  expect(typeof ossPlugin.config === 'function' ? ossPlugin.config(config, { command: 'build', mode: 'production' }) : null)
    .toBeUndefined()
  expect(config.base).toBe('/')
})

test('skips OSS manifest when any upload fails', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  writeFileSync(join(outDir, 'a.js'), 'a')
  writeFileSync(join(outDir, 'b.js'), 'b')
  const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

  ossMock.put.mockImplementation(async (name: string) => ({
    res: { status: name.endsWith('b.js') ? 500 : 200 },
  }))

  try {
    const result = await deployOss({
      open: true,
      accessKeyId: 'id',
      accessKeySecret: 'secret',
      bucket: 'bucket',
      region: 'oss-cn-hangzhou',
      uploadDir: 'assets',
      outDir,
      manifest: true,
      retryTimes: 1,
      failOnError: false,
      fancy: false,
    })

    expect(result.success).toBe(false)
    expect(consoleLog.mock.calls.some((call) => call.join(' ').includes('文件上传结束，成功 1/2，失败 1'))).toBe(true)
    expect(ossMock.put).not.toHaveBeenCalledWith(
      'assets/oss-manifest.json',
      expect.any(String),
      expect.any(Object),
    )
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

test('keeps OSS outDir root when autoDelete removes uploaded files', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  const nestedDir = join(outDir, 'nested')
  const rootFile = join(outDir, 'a.js')
  const nestedFile = join(nestedDir, 'b.js')
  mkdirSync(nestedDir)
  writeFileSync(rootFile, 'a')
  writeFileSync(nestedFile, 'b')

  ossMock.put.mockResolvedValue({ res: { status: 200 } })

  try {
    await deployOss({
      open: true,
      accessKeyId: 'id',
      accessKeySecret: 'secret',
      bucket: 'bucket',
      region: 'oss-cn-hangzhou',
      uploadDir: 'assets',
      outDir,
      autoDelete: true,
      retryTimes: 1,
      fancy: false,
    })

    expect(existsSync(rootFile)).toBe(false)
    expect(existsSync(nestedFile)).toBe(false)
    expect(existsSync(nestedDir)).toBe(false)
    expect(existsSync(outDir)).toBe(true)
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

test('keeps local empty directories when OSS autoDelete is disabled', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  const emptyDir = join(outDir, 'empty')
  mkdirSync(emptyDir)
  writeFileSync(join(outDir, 'a.js'), 'a')

  ossMock.put.mockResolvedValue({ res: { status: 200 } })

  try {
    await deployOss({
      open: true,
      accessKeyId: 'id',
      accessKeySecret: 'secret',
      bucket: 'bucket',
      region: 'oss-cn-hangzhou',
      uploadDir: 'assets',
      outDir,
      autoDelete: false,
      retryTimes: 1,
      fancy: false,
    })

    expect(existsSync(emptyDir)).toBe(true)
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

test('prints successfully uploaded OSS files when enabled', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  writeFileSync(join(outDir, 'a.js'), 'a')
  writeFileSync(join(outDir, 'b.css'), 'b')
  const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

  ossMock.put.mockResolvedValue({ res: { status: 200 } })

  try {
    await deployOss({
      open: true,
      accessKeyId: 'id',
      accessKeySecret: 'secret',
      bucket: 'bucket',
      region: 'oss-cn-hangzhou',
      uploadDir: 'assets',
      outDir,
      showUploadedFiles: true,
      retryTimes: 1,
      fancy: false,
    })

    const output = consoleLog.mock.calls.map((call) => call.join(' ')).join('\n')
    expect(output).toContain('上传成功文件')
    expect(output).toContain('• a.js · 1 B -> assets/a.js')
    expect(output).toContain('• b.css · 1 B -> assets/b.css')

    const calls = consoleLog.mock.calls.map((call) => call.join(' '))
    const lastUploadedFileIndex = Math.max(
      calls.findIndex((line) => line.includes('• a.js · 1 B -> assets/a.js')),
      calls.findIndex((line) => line.includes('• b.css · 1 B -> assets/b.css')),
    )
    expect(calls[lastUploadedFileIndex + 1]).toBe('')
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

test('returns uploaded OSS results when manifest upload fails without throwing', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  writeFileSync(join(outDir, 'a.js'), 'a')

  ossMock.put.mockImplementation(async (name: string) => ({
    res: { status: name.endsWith('oss-manifest.json') ? 500 : 200 },
  }))

  try {
    const result = await deployOss({
      open: true,
      accessKeyId: 'id',
      accessKeySecret: 'secret',
      bucket: 'bucket',
      region: 'oss-cn-hangzhou',
      uploadDir: 'assets',
      outDir,
      manifest: true,
      retryTimes: 1,
      failOnError: false,
      fancy: false,
    })

    expect(result.success).toBe(false)
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativeFilePath: 'a.js', success: true }),
        expect.objectContaining({ relativeFilePath: 'oss-manifest.json', success: false }),
      ]),
    )
    expect(result.uploadedBytes).toBe(1)
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

test.each([
  './index.html',
  ['./index.html?123'],
])('writes OSS manifest run entry %j', async (run) => {
  const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  writeFileSync(join(outDir, 'a.js'), 'a')

  ossMock.put.mockResolvedValue({ res: { status: 200 } })

  try {
    await deployOss({
      open: true,
      accessKeyId: 'id',
      accessKeySecret: 'secret',
      bucket: 'bucket',
      region: 'oss-cn-hangzhou',
      uploadDir: 'assets',
      outDir,
      manifest: { run },
      retryTimes: 1,
      fancy: false,
    })

    const manifest = JSON.parse(readFileSync(join(outDir, 'oss-manifest.json'), 'utf8')) as { run?: unknown }
    expect(manifest.run).toEqual(run)
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})
