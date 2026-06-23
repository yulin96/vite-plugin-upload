import { defineDeployOssConfig } from '../dist/index.js'

export default defineDeployOssConfig({
  accessKeyId: process.env.zAccessKeyId || '',
  accessKeySecret: process.env.zAccessKeySecret || '',
  bucket: process.env.zBucket || '',
  region: 'oss-cn-beijing',
  alias: process.env.zBucketAlias || '',

  outDir: 'playground/__dist__',
  uploadDir: '/test/vite-plugin-upload/oss/__direct-cli__/',
  skip: ['**/*.html', '**/pluginWebUpdateNotice/**'],
  overwrite: true,
  autoDelete: false,
  manifest: true,
  configBase: `${process.env.zBucketAlias || ''}/test/vite-plugin-upload/oss/__direct-cli__/`,
})
