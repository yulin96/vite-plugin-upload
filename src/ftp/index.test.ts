import { resolve } from 'node:path'
import { expect, test, vi } from 'vitest'
import type { Plugin } from 'vite'
import { deployFtp } from './deploy'
import vitePluginDeployFtp from './index'

vi.mock('./deploy', () => ({ deployFtp: vi.fn() }))

const options = { host: 'example.com', user: 'user', password: 'password', uploadPath: '/assets' }

function hook<T extends (...args: never[]) => unknown>(value: T | { handler: T } | undefined): T {
  if (!value) throw new Error('Missing plugin hook')
  return typeof value === 'function' ? value : value.handler
}

test('deploys the resolved output directory once at closeBundle', async () => {
  const plugin = vitePluginDeployFtp({ ...options, open: true })
  hook(plugin.config).call({} as never, { base: '/' }, { command: 'build', mode: 'production' })
  hook(plugin.configResolved).call({} as never, { root: '/project', build: { outDir: 'output' } } as never)
  await hook(plugin.closeBundle).call({} as never)
  expect(deployFtp).toHaveBeenCalledTimes(1)
  expect(deployFtp).toHaveBeenCalledWith(expect.objectContaining({ outDir: resolve('/project', 'output'), open: true }))
})

test.each(['closed', 'build failed', 'config missing', 'resolved config missing'])(
  'does not deploy when %s', async (state) => {
    const plugin: Plugin = vitePluginDeployFtp({ ...options, open: state !== 'closed' })
    if (state !== 'config missing') {
      hook(plugin.config).call({} as never, {}, { command: 'build', mode: 'production' })
    }
    if (state !== 'resolved config missing') {
      hook(plugin.configResolved).call({} as never, { root: '/project', build: { outDir: 'output' } } as never)
    }
    if (state === 'build failed') hook(plugin.buildEnd).call({} as never, new Error('build failed'))
    await hook(plugin.closeBundle).call({} as never)
    expect(deployFtp).not.toHaveBeenCalled()
  },
)

test('keeps the plugin closed by default without changing config', async () => {
  const plugin = vitePluginDeployFtp(options)
  const config = { base: '/' }
  expect(hook(plugin.config).call({} as never, config, { command: 'build', mode: 'production' })).toBeUndefined()
  expect(config.base).toBe('/')
  hook(plugin.configResolved).call({} as never, { root: '/project', build: { outDir: 'output' } } as never)
  await hook(plugin.closeBundle).call({} as never)
  expect(deployFtp).not.toHaveBeenCalled()
})
