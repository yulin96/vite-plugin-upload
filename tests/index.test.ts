import { expect, test } from 'vitest'
import { vitePluginUpload } from '../src'

test('creates upload plugins from enabled targets', () => {
  const plugins = vitePluginUpload({
    ftp: {
      host: 'example.com',
      user: 'user',
      password: 'password',
      uploadPath: '/dist',
      open: false,
    },
    oss: {
      accessKeyId: 'id',
      accessKeySecret: 'secret',
      bucket: 'bucket',
      region: 'oss-cn-hangzhou',
      uploadDir: 'dist',
      open: false,
    },
  })

  expect(plugins.map((plugin) => plugin.name)).toEqual(['vite-plugin-deploy-ftp', 'vite-plugin-deploy-oss'])
})
