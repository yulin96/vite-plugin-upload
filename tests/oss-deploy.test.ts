import chalk from 'chalk'
import type OSS from 'ali-oss'
import { stripVTControlCharacters } from 'node:util'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { deployOss } from '../src/oss/deploy'
import { createUploadFixture, deferred } from './helpers/upload'

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

const deploymentOptions = {
  accessKeyId: 'id', accessKeySecret: 'secret', bucket: 'bucket', region: 'oss-cn-hangzhou',
  uploadDir: 'assets', fancy: false, retryTimes: 1,
}

beforeEach(() => {
  ossMock.put.mockReset().mockResolvedValue({ res: { status: 200 } })
  ossMock.multipartUpload.mockReset().mockResolvedValue({ res: { status: 200 } })
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

test('skips OSS manifest when any upload fails', async () => {
  const outDir = createUploadFixture().outDir
  writeFileSync(join(outDir, 'a.js'), 'a')
  writeFileSync(join(outDir, 'b.js'), 'b')
  const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

  ossMock.put.mockImplementation(async (name: string) => ({
    res: { status: name.endsWith('b.js') ? 500 : 200 },
  }))

  const result = await deployOss({
    ...deploymentOptions,
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
})

test('keeps OSS outDir root when autoDelete removes uploaded files', async () => {
  const outDir = createUploadFixture().outDir
  const nestedDir = join(outDir, 'nested')
  const rootFile = join(outDir, 'a.js')
  const nestedFile = join(nestedDir, 'b.js')
  mkdirSync(nestedDir)
  writeFileSync(rootFile, 'a')
  writeFileSync(nestedFile, 'b')

  ossMock.put.mockResolvedValue({ res: { status: 200 } })

  await deployOss({
    ...deploymentOptions,
    outDir,
    autoDelete: true,
    retryTimes: 1,
    fancy: false,
  })

  expect(existsSync(rootFile)).toBe(false)
  expect(existsSync(nestedFile)).toBe(false)
  expect(existsSync(nestedDir)).toBe(false)
  expect(existsSync(outDir)).toBe(true)
})

test('keeps local empty directories when OSS autoDelete is disabled', async () => {
  const outDir = createUploadFixture().outDir
  const emptyDir = join(outDir, 'empty')
  mkdirSync(emptyDir)
  writeFileSync(join(outDir, 'a.js'), 'a')

  ossMock.put.mockResolvedValue({ res: { status: 200 } })

  await deployOss({
    ...deploymentOptions,
    outDir,
    autoDelete: false,
    retryTimes: 1,
    fancy: false,
  })

  expect(existsSync(emptyDir)).toBe(true)
})

test.each([0, 1, 3] as const)('prints successfully uploaded OSS files with color level %i', async (colorLevel) => {
  const outDir = createUploadFixture().outDir
  writeFileSync(join(outDir, 'a.js'), 'a')
  writeFileSync(join(outDir, 'b.css'), 'b')
  const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})

  ossMock.put.mockResolvedValue({ res: { status: 200 } })

  const previousColorLevel = chalk.level
  try {
    chalk.level = colorLevel
    await deployOss({
      ...deploymentOptions,
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
  }
})

test('returns uploaded OSS results when manifest upload fails without throwing', async () => {
  const outDir = createUploadFixture().outDir
  writeFileSync(join(outDir, 'a.js'), 'a')

  ossMock.put.mockImplementation(async (name: string) => ({
    res: { status: name.endsWith('oss-manifest.json') ? 500 : 200 },
  }))

  const result = await deployOss({
    ...deploymentOptions,
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
})

test('includes a successful OSS manifest in results and upload statistics', async () => {
  const outDir = createUploadFixture().outDir
  writeFileSync(join(outDir, 'a.js'), 'a')

  ossMock.put.mockResolvedValue({ res: { status: 200 } })

  const result = await deployOss({
    ...deploymentOptions,
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
})

test('encodes each OSS manifest URL path segment', async () => {
  const outDir = createUploadFixture().outDir
  writeFileSync(join(outDir, 'a#b?.js'), 'a')
  writeFileSync(join(outDir, 'a%20b.js'), 'b')

  ossMock.put.mockResolvedValue({ res: { status: 200 } })

  await deployOss({
    ...deploymentOptions,
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
})

test.each(['../outside.json', 'nested/../../outside.json', '/tmp/outside.json', 'C:\\outside.json', './manifest.json', ''])(
  'rejects unsafe OSS manifest file name %j',
  async (fileName) => {
    const outDir = createUploadFixture().outDir
    writeFileSync(join(outDir, 'a.js'), 'a')

    try {
      await expect(
        deployOss({
          ...deploymentOptions,
          outDir,
          manifest: { fileName },
          retryTimes: 1,
          fancy: false,
        }),
      ).rejects.toThrow('manifest.fileName')
      expect(ossMock.put).not.toHaveBeenCalled()
    } finally {
      }
  },
)

test('rejects a missing OSS outDir by default and returns failure when failOnError is disabled', async () => {
  const parentDir = createUploadFixture().outDir
  const outDir = join(parentDir, 'missing')
  const option = {
    ...deploymentOptions,
    outDir,
    retryTimes: 1,
    fancy: false,
  } as const
  vi.spyOn(console, 'log').mockImplementation(() => {})

  await expect(deployOss(option)).rejects.toThrow('OSS outDir does not exist or cannot be read')
  const result = await deployOss({ ...option, failOnError: false })
  expect(result).toEqual(expect.objectContaining({ success: false, results: [], outDir }))
  expect(ossMock.put).not.toHaveBeenCalled()
})

test('rejects an empty OSS outDir', async () => {
  const outDir = createUploadFixture().outDir
  vi.spyOn(console, 'log').mockImplementation(() => {})

  await expect(
    deployOss({
      ...deploymentOptions,
      outDir,
      retryTimes: 1,
      fancy: false,
    }),
  ).rejects.toThrow('OSS outDir contains no files to upload')
})

test.each([
  './index.html',
  ['./index.html?123'],
])('writes OSS manifest run entry %j', async (run) => {
  const outDir = createUploadFixture().outDir
  writeFileSync(join(outDir, 'a.js'), 'a')

  ossMock.put.mockResolvedValue({ res: { status: 200 } })

  await deployOss({
    ...deploymentOptions,
    outDir,
    manifest: { run },
    retryTimes: 1,
    fancy: false,
  })

  const manifest = JSON.parse(readFileSync(join(outDir, 'oss-manifest.json'), 'utf8')) as { run?: unknown }
  expect(manifest.run).toEqual(run)
})


test('uses multipart upload at the threshold and preserves upload headers', async () => {
  const outDir = createUploadFixture().outDir
  writeFileSync(join(outDir, 'small.js'), 'a')
  writeFileSync(join(outDir, 'large.js'), 'abcd')
  ossMock.put.mockResolvedValue({ res: { status: 200 } })
  ossMock.multipartUpload.mockResolvedValue({ res: { status: 200 } })
  const result = await deployOss({ ...deploymentOptions, outDir, multipartThreshold: 4, concurrency: 8, overwrite: false, noCache: true })
  expect(result).toMatchObject({ success: true, uploadedBytes: 5, retryCount: 0 })
  expect(ossMock.put).toHaveBeenCalledExactlyOnceWith('assets/small.js', join(outDir, 'small.js'), expect.objectContaining({
    headers: expect.objectContaining({ 'Cache-Control': 'no-cache', 'x-oss-forbid-overwrite': 'true' }),
  }))
  expect(ossMock.multipartUpload).toHaveBeenCalledExactlyOnceWith('assets/large.js', join(outDir, 'large.js'), expect.objectContaining({ parallel: 4 }))
})

test('retries a failed upload and counts the successful bytes only once', async () => {
  const outDir = createUploadFixture().outDir
  writeFileSync(join(outDir, 'a.js'), 'abc')
  ossMock.put.mockRejectedValueOnce(new Error('connection reset')).mockResolvedValue({ res: { status: 200 } })
  // Keep filesystem I/O real; accelerate only the upload backoff.
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void) => {
    queueMicrotask(callback)
    return {} as ReturnType<typeof setTimeout>
  }) as typeof setTimeout)
  const result = await deployOss({ ...deploymentOptions, outDir, retryTimes: 2 })
  expect(ossMock.put).toHaveBeenCalledTimes(2)
  expect(result).toMatchObject({ success: true, retryCount: 1, uploadedBytes: 3 })
  expect(result.results[0]).toMatchObject({ success: true, retries: 1 })
})

test('keeps failed files locally while deleting only successful uploads', async () => {
  const outDir = createUploadFixture().outDir
  writeFileSync(join(outDir, 'good.js'), 'a')
  writeFileSync(join(outDir, 'bad.js'), 'b')
  ossMock.put.mockImplementation(async (name: string) => ({ res: { status: name.endsWith('bad.js') ? 500 : 200 } }))
  const result = await deployOss({ ...deploymentOptions, outDir, autoDelete: true, failOnError: false })
  expect(result.success).toBe(false)
  expect(result.uploadedBytes).toBe(1)
  expect(existsSync(join(outDir, 'good.js'))).toBe(false)
  expect(readFileSync(join(outDir, 'bad.js'), 'utf8')).toBe('b')
})

test('uploads HTML and retains sources when manifest overrides skip and autoDelete', async () => {
  const outDir = createUploadFixture().outDir
  writeFileSync(join(outDir, 'index.html'), 'html')
  writeFileSync(join(outDir, 'oss-manifest.json'), 'stale manifest')
  ossMock.put.mockResolvedValue({ res: { status: 200 } })
  await deployOss({ ...deploymentOptions, outDir, manifest: true, autoDelete: true, skip: '**/*' })
  expect(ossMock.put.mock.calls.map(([name]) => name)).toEqual(['assets/index.html', 'assets/oss-manifest.json'])
  expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toBe('html')
  const manifest = JSON.parse(readFileSync(join(outDir, 'oss-manifest.json'), 'utf8'))
  expect(manifest.files).toEqual([expect.objectContaining({ file: 'index.html', md5: 'fc35fdc70d5fc69d269883a822c7a53e' })])
  expect(ossMock.put.mock.calls[1]?.[2]).toMatchObject({ headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } })
})

test.each(['file', 'parent'] as const)('rejects manifest symlink escape through %s without overwriting external content', async (kind) => {
  const { outDir } = createUploadFixture({ 'a.js': 'a' })
  const { outDir: externalDir } = createUploadFixture({ 'manifest.json': 'external original' })
  const fileName = kind === 'file' ? 'manifest.json' : '.metadata/manifest.json'
  symlinkSync(kind === 'file' ? join(externalDir, 'manifest.json') : externalDir, join(outDir, kind === 'file' ? fileName : '.metadata'))
  ossMock.put.mockResolvedValue({ res: { status: 200 } })
  await expect(deployOss({ ...deploymentOptions, outDir, manifest: { fileName } })).rejects.toThrow(/symbolic link|inside outDir/)
  expect(readFileSync(join(externalDir, 'manifest.json'), 'utf8')).toBe('external original')
  expect(ossMock.put.mock.calls.some(([name]) => name === `assets/${fileName}`)).toBe(false)
})

test('uploads filenames with surrounding whitespace without changing their identity', async () => {
  const { outDir } = createUploadFixture({ ' only.js ': 'abc' })
  ossMock.put.mockResolvedValue({ res: { status: 200 } })
  const result = await deployOss({ ...deploymentOptions, outDir, manifest: true })
  expect(result.success).toBe(true)
  expect(ossMock.put).toHaveBeenCalledWith('assets/ only.js ', join(outDir, ' only.js '), expect.any(Object))
  const manifest = JSON.parse(readFileSync(join(outDir, 'oss-manifest.json'), 'utf8'))
  expect(manifest.files).toEqual([{ file: ' only.js ', key: 'assets/ only.js ', url: 'assets/ only.js ', md5: '900150983cd24fb0d6963f7d28e17f72' }])
})

test.each([true, false])('does not publish HTML or manifest after asset failure with failOnError=%s', async (failOnError) => {
  const { outDir } = createUploadFixture({ 'index.html': 'old entry', 'broken.js': 'broken' })
  ossMock.put.mockRejectedValue(new Error('asset rejected'))
  const deployment = deployOss({ ...deploymentOptions, outDir, manifest: true, failOnError })
  if (failOnError) await expect(deployment).rejects.toThrow('Failed to upload')
  else expect((await deployment).success).toBe(false)
  expect(ossMock.put.mock.calls.map(([name]) => name)).toEqual(['assets/broken.js'])
  expect(readFileSync(join(outDir, 'index.html'), 'utf8')).toBe('old entry')
  expect(existsSync(join(outDir, 'oss-manifest.json'))).toBe(false)
})

test('finishes all assets before publishing HTML and publishes manifest last', async () => {
  const { outDir } = createUploadFixture({ 'index.html': 'html', 'a.js': 'a', 'b.js': 'b' })
  const assetsStarted = deferred()
  const releaseAssets = deferred()
  let started = 0
  ossMock.put.mockImplementation(async (name: string) => {
    if (name.endsWith('.js')) {
      if (++started === 2) assetsStarted.resolve()
      await releaseAssets.promise
    }
    return { res: { status: 200 } }
  })
  const deployment = deployOss({ ...deploymentOptions, outDir, manifest: true, concurrency: 2 })
  await assetsStarted.promise
  try {
    expect(ossMock.put.mock.calls.map(([name]) => name).sort()).toEqual(['assets/a.js', 'assets/b.js'])
  } finally { releaseAssets.resolve() }
  expect((await deployment).success).toBe(true)
  expect(ossMock.put.mock.calls.slice(2).map(([name]) => name)).toEqual(['assets/index.html', 'assets/oss-manifest.json'])
})

test('reuses the last multipart checkpoint on retry', async () => {
  const { outDir } = createUploadFixture({ 'large.bin': 'abcdefgh' })
  const checkpoint = { file: join(outDir, 'large.bin'), name: 'assets/large.bin', fileSize: 8, partSize: 4, uploadId: 'upload-1', doneParts: [{ number: 1, etag: 'part-1' }] } as OSS.Checkpoint
  ossMock.multipartUpload.mockImplementationOnce(async (_name: string, _file: string, options: OSS.MultipartUploadOptions) => {
    await options.progress?.(0.5, checkpoint, {} as never)
    throw new Error('connection reset')
  }).mockResolvedValue({ res: { status: 200 } })
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void) => {
    queueMicrotask(callback)
    return {} as ReturnType<typeof setTimeout>
  }) as typeof setTimeout)
  const result = await deployOss({ ...deploymentOptions, outDir, multipartThreshold: 4, retryTimes: 2 })
  expect(result).toMatchObject({ success: true, retryCount: 1, uploadedBytes: 8 })
  expect(ossMock.multipartUpload).toHaveBeenCalledTimes(2)
  expect(ossMock.multipartUpload.mock.calls[1]?.[2]?.checkpoint).toBe(checkpoint)
})

test('enforces OSS file concurrency without serializing independent files', async () => {
  const { outDir } = createUploadFixture({ 'a.js': 'a', 'b.js': 'b', 'c.js': 'c', 'd.js': 'd' })
  const fullWindow = deferred()
  const release = deferred()
  let active = 0
  let peak = 0
  ossMock.put.mockImplementation(async () => {
    peak = Math.max(peak, ++active)
    if (active === 2) fullWindow.resolve()
    await release.promise
    active--
    return { res: { status: 200 } }
  })
  const deployment = deployOss({ ...deploymentOptions, outDir, concurrency: 2 })
  await fullWindow.promise
  try { expect(ossMock.put).toHaveBeenCalledTimes(2) } finally { release.resolve() }
  const result = await deployment
  expect(peak).toBe(2)
  expect(result).toMatchObject({ success: true, uploadedBytes: 4, retryCount: 0 })
  expect(result.results.map((file) => file.name).sort()).toEqual(['assets/a.js', 'assets/b.js', 'assets/c.js', 'assets/d.js'])
})

test('configures multipart part size and parallelism independently of file concurrency', async () => {
  const { outDir } = createUploadFixture({ 'large.bin': 'abcdefgh' })
  const result = await deployOss({ ...deploymentOptions, outDir, multipartThreshold: 4, concurrency: 8, partSize: 4 * 1024 * 1024, multipartConcurrency: 2 })
  expect(result).toMatchObject({ success: true, uploadedBytes: 8 })
  expect(ossMock.multipartUpload).toHaveBeenCalledExactlyOnceWith('assets/large.bin', join(outDir, 'large.bin'), expect.objectContaining({ partSize: 4 * 1024 * 1024, parallel: 2 }))
})

test.each([{ partSize: 102399 }, { partSize: 102400.5 }, { multipartConcurrency: 0 }, { multipartConcurrency: 1.5 }])(
  'rejects invalid multipart options %j before uploading', async (options) => {
    const { outDir } = createUploadFixture({ 'a.js': 'a' })
    await expect(deployOss({ ...deploymentOptions, outDir, ...options })).rejects.toThrow(/partSize|multipartConcurrency/)
    expect(ossMock.put).not.toHaveBeenCalled()
    expect(ossMock.multipartUpload).not.toHaveBeenCalled()
  },
)

test('discards a checkpoint whose upload ID no longer exists', async () => {
  const { outDir } = createUploadFixture({ 'large.bin': 'abcdefgh' })
  const checkpoint: OSS.Checkpoint = { file: join(outDir, 'large.bin'), name: 'assets/large.bin', fileSize: 8, partSize: 4, uploadId: 'expired-upload', doneParts: [] }
  ossMock.multipartUpload.mockImplementationOnce(async (_name: string, _file: string, options: OSS.MultipartUploadOptions) => {
    await options.progress?.(0, checkpoint, {} as never)
    throw Object.assign(new Error('upload ID no longer exists'), { name: 'abort', code: 'NoSuchUpload' })
  }).mockResolvedValue({ res: { status: 200 } })
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void) => {
    queueMicrotask(callback)
    return {} as ReturnType<typeof setTimeout>
  }) as typeof setTimeout)
  const result = await deployOss({ ...deploymentOptions, outDir, multipartThreshold: 4, retryTimes: 2 })
  expect(result.success).toBe(true)
  expect(ossMock.multipartUpload).toHaveBeenCalledTimes(2)
  expect(ossMock.multipartUpload.mock.calls[1]?.[2]?.checkpoint).toBeUndefined()
})
