import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { expect, test, vi } from 'vitest'
import { deployOss } from './deploy'
import vitePluginDeployOss from './index'

vi.mock('./deploy', () => ({ deployOss: vi.fn() }))

test('injects an absolute OSS manifest URL into built HTML from configBase', () => {
  const plugin = vitePluginDeployOss({
    open: true,
    accessKeyId: 'id',
    accessKeySecret: 'secret',
    bucket: 'bucket',
    region: 'oss-cn-hangzhou',
    uploadDir: 'assets',
    configBase: 'https://cdn.example.com/project/',
    manifest: { fileName: 'metadata/oss manifest.json' },
  }) as Plugin
  const config = { base: '/' }

  if (typeof plugin.config === 'function') {
    plugin.config.call({} as never, config, { command: 'build', mode: 'production' })
  }
  const transform = typeof plugin.transformIndexHtml === 'object' ? plugin.transformIndexHtml.handler : null
  const result = transform?.call(
    {} as never,
    '<!doctype html>\n<html>\n  <head>\n    <title>App</title>\n  </head>\n</html>',
    { path: '/index.html', filename: 'index.html' } as never,
  )

  expect(result).toBe(
    '<!doctype html>\n<html>\n  <head>\n    <meta name="vite-plugin-upload-manifest" content="https://cdn.example.com/project/metadata/oss%20manifest.json">\n\n    <title>App</title>\n  </head>\n</html>',
  )
})

test('injects an absolute OSS manifest URL from alias and uploadDir', () => {
  const plugin = vitePluginDeployOss({
    open: true,
    accessKeyId: 'id',
    accessKeySecret: 'secret',
    bucket: 'bucket',
    region: 'oss-cn-hangzhou',
    uploadDir: 'project/assets',
    alias: 'https://oss.example.com/',
    manifest: true,
  }) as Plugin
  const config = { base: '/' }

  if (typeof plugin.config === 'function') {
    plugin.config.call({} as never, config, { command: 'build', mode: 'production' })
  }
  const transform = typeof plugin.transformIndexHtml === 'object' ? plugin.transformIndexHtml.handler : null
  const result = transform?.call(
    {} as never,
    '<html>\r\n\t<head class="app">\r\n\t</head>\r\n</html>',
    { path: '/nested/index.html', filename: 'index.html' } as never,
  )

  expect(result).toContain(
    '<head class="app">\r\n\t\t<meta name="vite-plugin-upload-manifest" content="https://oss.example.com/project/assets/oss-manifest.json">\r\n\r\n\t</head>',
  )
})

test('rejects OSS manifest HTML injection without an absolute public URL', () => {
  expect(() =>
    vitePluginDeployOss({
      open: true,
      accessKeyId: 'id',
      accessKeySecret: 'secret',
      bucket: 'bucket',
      region: 'oss-cn-hangzhou',
      uploadDir: 'assets',
      manifest: true,
    }),
  ).toThrow('absolute http(s) configBase or alias URL')
})

const options = { accessKeyId: 'id', accessKeySecret: 'secret', bucket: 'bucket', region: 'oss-cn-hangzhou', uploadDir: 'assets', configBase: 'https://cdn.example.com/assets' }

function hook<T extends (...args: never[]) => unknown>(value: T | { handler: T } | undefined): T {
  if (!value) throw new Error('Missing plugin hook')
  return typeof value === 'function' ? value : value.handler
}

test('deploys the resolved output directory once at closeBundle', async () => {
  const plugin = vitePluginDeployOss({ ...options, open: true })
  hook(plugin.config).call({} as never, { base: '/' }, { command: 'build', mode: 'production' })
  hook(plugin.configResolved).call({} as never, { root: '/project', build: { outDir: 'output' } } as never)
  await hook(plugin.closeBundle).call({} as never)
  expect(deployOss).toHaveBeenCalledTimes(1)
  expect(deployOss).toHaveBeenCalledWith(expect.objectContaining({ outDir: resolve('/project', 'output'), open: true }))
})

test.each(['closed', 'build failed', 'config missing', 'resolved config missing'])(
  'does not deploy when %s', async (state) => {
    const plugin: Plugin = vitePluginDeployOss({ ...options, open: state !== 'closed' })
    if (state !== 'config missing') {
      hook(plugin.config).call({} as never, {}, { command: 'build', mode: 'production' })
    }
    if (state !== 'resolved config missing') {
      hook(plugin.configResolved).call({} as never, { root: '/project', build: { outDir: 'output' } } as never)
    }
    if (state === 'build failed') hook(plugin.buildEnd).call({} as never, new Error('build failed'))
    await hook(plugin.closeBundle).call({} as never)
    expect(deployOss).not.toHaveBeenCalled()
  },
)

test('keeps the plugin closed by default without changing config', async () => {
  const plugin = vitePluginDeployOss(options)
  const config = { base: '/' }
  expect(hook(plugin.config).call({} as never, config, { command: 'build', mode: 'production' })).toBeUndefined()
  expect(config.base).toBe('/')
  hook(plugin.configResolved).call({} as never, { root: '/project', build: { outDir: 'output' } } as never)
  await hook(plugin.closeBundle).call({} as never)
  expect(deployOss).not.toHaveBeenCalled()
})
