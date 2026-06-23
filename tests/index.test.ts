import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
    expect(ossMock.put).not.toHaveBeenCalledWith(
      'assets/oss-manifest.json',
      expect.any(String),
      expect.any(Object),
    )
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})
