import chalk from 'chalk'
import { stripVTControlCharacters } from 'node:util'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { deployOss } from '../src/oss/deploy'

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

test.each([0, 1, 3] as const)('prints successfully uploaded OSS files with color level %i', async (colorLevel) => {
  const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  writeFileSync(join(outDir, 'a.js'), 'a')
  writeFileSync(join(outDir, 'b.css'), 'b')
  const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

  ossMock.put.mockResolvedValue({ res: { status: 200 } })

  const previousColorLevel = chalk.level
  try {
    chalk.level = colorLevel
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

    const calls = consoleLog.mock.calls.map((call) => stripVTControlCharacters(call.join(' ')))
    const output = calls.join('\n')
    expect(output).toContain('上传成功文件')
    expect(output).toContain('• a.js · 1 B -> assets/a.js')
    expect(output).toContain('• b.css · 1 B -> assets/b.css')

    const lastUploadedFileIndex = Math.max(
      calls.findIndex((line) => line.includes('• a.js · 1 B -> assets/a.js')),
      calls.findIndex((line) => line.includes('• b.css · 1 B -> assets/b.css')),
    )
    expect(calls[lastUploadedFileIndex + 1]).toBe('')
  } finally {
    chalk.level = previousColorLevel
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

test('includes a successful OSS manifest in results and upload statistics', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  writeFileSync(join(outDir, 'a.js'), 'a')

  ossMock.put.mockResolvedValue({ res: { status: 200 } })

  try {
    const result = await deployOss({
      open: true,
      accessKeyId: 'id',
      accessKeySecret: 'secret',
      bucket: 'bucket',
      region: 'oss-cn-hangzhou',
      uploadDir: 'assets',
      outDir,
      manifest: { fileName: 'metadata/oss-manifest.json' },
      retryTimes: 1,
      fancy: false,
    })

    const manifestSize = Buffer.byteLength(readFileSync(join(outDir, 'metadata/oss-manifest.json')))
    expect(result.success).toBe(true)
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativeFilePath: 'a.js', success: true }),
        expect.objectContaining({ relativeFilePath: 'metadata/oss-manifest.json', success: true }),
      ]),
    )
    expect(result.results).toHaveLength(2)
    expect(result.uploadedBytes).toBe(1 + manifestSize)
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

test('encodes each OSS manifest URL path segment', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  writeFileSync(join(outDir, 'a#b?.js'), 'a')
  writeFileSync(join(outDir, 'a%20b.js'), 'b')

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
      configBase: 'https://cdn.example.com/assets/',
      manifest: true,
      retryTimes: 1,
      fancy: false,
    })

    const manifest = JSON.parse(readFileSync(join(outDir, 'oss-manifest.json'), 'utf8')) as {
      files: Array<{ file: string; url: string }>
    }
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'a#b?.js', url: 'https://cdn.example.com/assets/a%23b%3F.js' }),
        expect.objectContaining({ file: 'a%20b.js', url: 'https://cdn.example.com/assets/a%2520b.js' }),
      ]),
    )
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

test.each(['../outside.json', 'nested/../../outside.json', '/tmp/outside.json', 'C:\\outside.json', './manifest.json', ''])(
  'rejects unsafe OSS manifest file name %j',
  async (fileName) => {
    const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
    writeFileSync(join(outDir, 'a.js'), 'a')

    try {
      await expect(
        deployOss({
          open: true,
          accessKeyId: 'id',
          accessKeySecret: 'secret',
          bucket: 'bucket',
          region: 'oss-cn-hangzhou',
          uploadDir: 'assets',
          outDir,
          manifest: { fileName },
          retryTimes: 1,
          fancy: false,
        }),
      ).rejects.toThrow('manifest.fileName')
      expect(ossMock.put).not.toHaveBeenCalled()
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  },
)

test('rejects a missing OSS outDir by default and returns failure when failOnError is disabled', async () => {
  const parentDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  const outDir = join(parentDir, 'missing')
  const option = {
    open: true,
    accessKeyId: 'id',
    accessKeySecret: 'secret',
    bucket: 'bucket',
    region: 'oss-cn-hangzhou',
    uploadDir: 'assets',
    outDir,
    retryTimes: 1,
    fancy: false,
  } as const
  vi.spyOn(console, 'log').mockImplementation(() => {})

  try {
    await expect(deployOss(option)).rejects.toThrow('OSS outDir does not exist or cannot be read')
    const result = await deployOss({ ...option, failOnError: false })
    expect(result).toEqual(expect.objectContaining({ success: false, results: [], outDir }))
    expect(ossMock.put).not.toHaveBeenCalled()
  } finally {
    rmSync(parentDir, { recursive: true, force: true })
  }
})

test('rejects an empty OSS outDir', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  vi.spyOn(console, 'log').mockImplementation(() => {})

  try {
    await expect(
      deployOss({
        open: true,
        accessKeyId: 'id',
        accessKeySecret: 'secret',
        bucket: 'bucket',
        region: 'oss-cn-hangzhou',
        uploadDir: 'assets',
        outDir,
        retryTimes: 1,
        fancy: false,
      }),
    ).rejects.toThrow('OSS outDir contains no files to upload')
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

const deploymentOptions = {
  accessKeyId: 'id', accessKeySecret: 'secret', bucket: 'bucket', region: 'oss-cn-hangzhou',
  uploadDir: 'assets', fancy: false, retryTimes: 1,
}

test('uses multipart upload at the threshold and preserves upload headers', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  writeFileSync(join(outDir, 'small.js'), 'a')
  writeFileSync(join(outDir, 'large.js'), 'abcd')
  ossMock.put.mockResolvedValue({ res: { status: 200 } })
  ossMock.multipartUpload.mockResolvedValue({ res: { status: 200 } })
  try {
    const result = await deployOss({ ...deploymentOptions, outDir, multipartThreshold: 4, concurrency: 8, overwrite: false, noCache: true })
    expect(result).toMatchObject({ success: true, uploadedBytes: 5, retryCount: 0 })
    expect(ossMock.put).toHaveBeenCalledExactlyOnceWith('assets/small.js', join(outDir, 'small.js'), expect.objectContaining({
      headers: expect.objectContaining({ 'Cache-Control': 'no-cache', 'x-oss-forbid-overwrite': 'true' }),
    }))
    expect(ossMock.multipartUpload).toHaveBeenCalledExactlyOnceWith('assets/large.js', join(outDir, 'large.js'), expect.objectContaining({ parallel: 4 }))
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

test('retries a failed upload and counts the successful bytes only once', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  writeFileSync(join(outDir, 'a.js'), 'abc')
  ossMock.put.mockRejectedValueOnce(new Error('connection reset')).mockResolvedValue({ res: { status: 200 } })
  // Keep filesystem I/O real; accelerate only the upload backoff.
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void) => {
    queueMicrotask(callback)
    return {} as ReturnType<typeof setTimeout>
  }) as typeof setTimeout)
  try {
    const result = await deployOss({ ...deploymentOptions, outDir, retryTimes: 2 })
    expect(ossMock.put).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ success: true, retryCount: 1, uploadedBytes: 3 })
    expect(result.results[0]).toMatchObject({ success: true, retries: 1 })
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

test('keeps failed files locally while deleting only successful uploads', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  writeFileSync(join(outDir, 'good.js'), 'a')
  writeFileSync(join(outDir, 'bad.js'), 'b')
  ossMock.put.mockImplementation(async (name: string) => ({ res: { status: name.endsWith('bad.js') ? 500 : 200 } }))
  try {
    const result = await deployOss({ ...deploymentOptions, outDir, autoDelete: true, failOnError: false })
    expect(result.success).toBe(false)
    expect(result.uploadedBytes).toBe(1)
    expect(existsSync(join(outDir, 'good.js'))).toBe(false)
    expect(readFileSync(join(outDir, 'bad.js'), 'utf8')).toBe('b')
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})

test('uploads HTML and retains sources when manifest overrides skip and autoDelete', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  writeFileSync(join(outDir, 'index.html'), 'html')
  writeFileSync(join(outDir, 'oss-manifest.json'), 'stale manifest')
  ossMock.put.mockResolvedValue({ res: { status: 200 } })
  try {
    await deployOss({ ...deploymentOptions, outDir, manifest: true, autoDelete: true, skip: '**/*' })
    expect(ossMock.put.mock.calls.map(([name]) => name)).toEqual(['assets/index.html', 'assets/oss-manifest.json'])
    expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toBe('html')
    const manifest = JSON.parse(readFileSync(join(outDir, 'oss-manifest.json'), 'utf8'))
    expect(manifest.files).toEqual([expect.objectContaining({ file: 'index.html', md5: 'fc35fdc70d5fc69d269883a822c7a53e' })])
    expect(ossMock.put.mock.calls[1]?.[2]).toMatchObject({ headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } })
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})
