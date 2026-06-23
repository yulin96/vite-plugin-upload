import { deployOss } from '../dist/oss/deploy.mjs'

await deployOss({
  accessKeyId: process.env.zAccessKeyId || '',
  accessKeySecret: process.env.zAccessKeySecret || '',
  bucket: process.env.zBucket || '',
  region: 'oss-cn-beijing',
  alias: process.env.zBucketAlias || '',

  outDir: 'playground/__dist__',
  uploadDir: '/test/vite-plugin-upload/oss/__direct-api__/',
  skip: ['**/*.html', '**/pluginWebUpdateNotice/**'],
  overwrite: true,
  autoDelete: false,
  manifest: true,
  configBase: `${process.env.zBucketAlias || ''}/test/vite-plugin-upload/oss/__direct-api__/`,
})
