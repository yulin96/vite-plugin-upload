import { defineConfig } from 'vite'
import { vitePluginDeployFtp, vitePluginDeployOss } from '../src'

export default defineConfig(({ mode }) => {
  const shouldDeployFtp = mode === 'ftp' || mode === 'ftp-debug' || process.env.DEPLOY_FTP === '1'
  const shouldDeployOss = mode === 'oss' || mode === 'oss-debug' || process.env.DEPLOY_OSS === '1'
  const isFtpDebug = mode === 'ftp-debug' || process.env.DEPLOY_FTP_DEBUG === '1'
  const isOssDebug = mode === 'oss-debug' || process.env.DEPLOY_OSS_DEBUG === '1'

  return {
    plugins: [
      vitePluginDeployOss({
        open: shouldDeployOss,
        debug: isOssDebug,
        accessKeyId: process.env.zAccessKeyId || '',
        accessKeySecret: process.env.zAccessKeySecret || '',
        bucket: process.env.zBucket || '',
        region: 'oss-cn-beijing',
        alias: process.env.zBucketAlias || '',
        uploadDir: '/test/vite-plugin-upload/oss/',
        // skip: ['**/*.html', '**/pluginWebUpdateNotice/**'],
        overwrite: true,
        autoDelete: false,
        manifest: true,
        configBase: `${process.env.zBucketAlias || ''}/test/vite-plugin-upload/oss/`,
      }),

      vitePluginDeployFtp({
        open: shouldDeployFtp,
        debug: isFtpDebug,
        uploadPath: '/__test/vite-plugin-upload/ftp/',
        singleBack: true,
        autoUpload: true,
        defaultFtp: process.env.zH5FtpName,
        ftps: [
          {
            name: process.env.zH5FtpName || process.env.zH5FtpAlias || '',
            host: process.env.zH5FtpHost,
            port: +(process.env.zH5FtpPort || 21),
            user: process.env.zH5FtpUser,
            password: process.env.zH5FtpPassword,
            alias: process.env.zH5FtpAlias,
          },
          {
            name: process.env.zH5FtpName2 || process.env.zH5FtpAlias2 || '',
            host: process.env.zH5FtpHost2,
            port: +(process.env.zH5FtpPort2 || 21),
            user: process.env.zH5FtpUser2,
            password: process.env.zH5FtpPassword2,
            alias: process.env.zH5FtpAlias2,
          },
        ],
      }),
    ],

    base: './',

    build: {
      outDir: '__dist__',
      rollupOptions: {
        input: {
          main: './index.html',
        },
      },
    },
  }
})
