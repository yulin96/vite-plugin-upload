# vite-plugin-upload

Upload Vite build artifacts to FTP or Aliyun OSS.

## Installation

```bash
pnpm add vite-plugin-upload -D
```

## Quick Start

Use environment variables to control deployment. Keep uploads disabled during normal local builds.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { vitePluginDeployFtp, vitePluginDeployOss } from 'vite-plugin-upload'

export default defineConfig({
  plugins: [
    vitePluginDeployOss({
      open: process.env.DEPLOY_OSS === '1',
      failOnError: true,
      accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
      bucket: process.env.OSS_BUCKET || '',
      region: process.env.OSS_REGION || '',
      uploadDir: 'H5/demo/prod',
      configBase: 'https://example.com/H5/demo/prod/',
      manifest: {
        run: './index.html',
      },
    }),

    vitePluginDeployFtp({
      open: process.env.DEPLOY_FTP === '1',
      autoUpload: true,
      failOnError: true,
      host: process.env.FTP_HOST,
      port: +(process.env.FTP_PORT || 21),
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      uploadPath: process.env.FTP_PATH || '/public_html',
      alias: process.env.FTP_ALIAS,
      singleBack: true,
      singleBackFiles: ['index.html'],
    }),
  ],
})
```

You can also use a combined entry:

```ts
import { vitePluginUpload } from 'vite-plugin-upload'

export default {
  plugins: [
    vitePluginUpload({
      oss: {
        open: process.env.DEPLOY_OSS === '1',
        accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
        accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
        bucket: process.env.OSS_BUCKET || '',
        region: process.env.OSS_REGION || '',
        uploadDir: 'H5/demo/prod',
      },
      ftp: {
        open: process.env.DEPLOY_FTP === '1',
        host: process.env.FTP_HOST,
        user: process.env.FTP_USER,
        password: process.env.FTP_PASSWORD,
        uploadPath: '/public_html',
      },
    }),
  ],
}
```

## Direct API

Upload an already-built directory without running Vite.

```ts
import { deployFtp, deployOss } from 'vite-plugin-upload'

await deployFtp({
  host: process.env.FTP_HOST,
  port: +(process.env.FTP_PORT || 21),
  user: process.env.FTP_USER,
  password: process.env.FTP_PASSWORD,
  alias: process.env.FTP_ALIAS,
  outDir: 'dist',
  uploadPath: '/public_html',
  autoUpload: true,
})

await deployOss({
  accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
  bucket: process.env.OSS_BUCKET || '',
  region: process.env.OSS_REGION || '',
  outDir: 'dist',
  uploadDir: 'H5/demo/prod',
})
```

## Direct CLI

Create FTP config:

```js
// deploy-ftp.config.mjs
import { defineDeployFtpConfig } from 'vite-plugin-upload'

export default defineDeployFtpConfig({
  host: process.env.FTP_HOST,
  port: +(process.env.FTP_PORT || 21),
  user: process.env.FTP_USER,
  password: process.env.FTP_PASSWORD,
  outDir: 'dist',
  uploadPath: '/public_html',
  autoUpload: true,
})
```

Create OSS config:

```js
// deploy-oss.config.mjs
import { defineDeployOssConfig } from 'vite-plugin-upload'

export default defineDeployOssConfig({
  accessKeyId: process.env.OSS_ACCESS_KEY_ID || '',
  accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || '',
  bucket: process.env.OSS_BUCKET || '',
  region: process.env.OSS_REGION || '',
  outDir: 'dist',
  uploadDir: 'H5/demo/prod',
  manifest: true,
})
```

Run:

```bash
deploy-ftp --config deploy-ftp.config.mjs
deploy-oss --config deploy-oss.config.mjs
```

## FTP Configuration

| Option            | Default          | Description                                                               |
| :---------------- | :--------------- | :------------------------------------------------------------------------ |
| `open`            | `false`          | Enable FTP upload. Use environment variables to avoid accidental uploads. |
| `uploadPath`      | -                | FTP destination path. Supports `string` or `string[]`.                    |
| `host`            | -                | FTP host address.                                                         |
| `port`            | `21`             | FTP port.                                                                 |
| `user`            | -                | FTP username.                                                             |
| `password`        | -                | FTP password.                                                             |
| `alias`           | -                | Public URL used in terminal output.                                       |
| `secure`          | `false`          | Enable FTPS. Use `true` or `'implicit'` when the server requires it.       |
| `autoUpload`      | `false`          | Skip upload confirmation.                                                 |
| `singleBack`      | `false`          | Back up selected files before upload.                                     |
| `singleBackFiles` | `['index.html']` | Files to back up when `singleBack` is enabled.                            |
| `ftps`            | -                | Multiple FTP server configs.                                              |
| `defaultFtp`      | -                | Default FTP config name.                                                  |
| `concurrency`     | `8`              | Number of simultaneous uploads.                                           |
| `failOnError`     | `true`           | Fail the build when upload fails.                                         |
| `debug`           | `false`          | Print debug timing.                                                       |
| `fancy`           | `true`           | Show styled terminal output.                                              |
| `showUploadedFiles` | `false`        | Print successfully uploaded file list.                                     |

## OSS Configuration

| Option            | Default           | Description                                                               |
| :---------------- | :---------------- | :------------------------------------------------------------------------ |
| `open`            | `false`           | Enable OSS upload. Use environment variables to avoid accidental uploads. |
| `accessKeyId`     | -                 | OSS access key ID.                                                        |
| `accessKeySecret` | -                 | OSS access key secret.                                                    |
| `bucket`          | -                 | OSS bucket name.                                                          |
| `region`          | -                 | OSS region, e.g. `oss-cn-beijing`.                                        |
| `outDir`          | `'dist'`          | Local directory for CLI or direct API upload.                             |
| `uploadDir`       | -                 | Target directory in OSS.                                                  |
| `configBase`      | -                 | Updates Vite asset base and manifest URLs.                                |
| `alias`           | -                 | URL alias used by manifest.                                               |
| `skip`            | `'**/index.html'` | Files to skip.                                                            |
| `overwrite`       | `true`            | Whether to overwrite existing OSS files.                                  |
| `autoDelete`      | `false`           | Delete local files after successful upload.                               |
| `manifest`        | `false`           | Generate and upload `oss-manifest.json`.                                  |
| `failOnError`     | `true`            | Fail the build when upload fails.                                         |
| `debug`           | `false`           | Print debug timing.                                                       |
| `fancy`           | `true`            | Show styled terminal output.                                              |
| `showUploadedFiles` | `false`         | Print successfully uploaded file list.                                    |

## Important Behaviors

- Uploads run after Vite finishes building.
- When `open: false`, upload logic and required-option validation are skipped.
- FTP supports multiple upload paths and multiple FTP server configs.
- FTP can back up remote files before uploading.
- OSS `manifest: true` keeps local files and ignores the default `skip`.
- OSS `manifest: { run: './index.html' }` writes a runnable entry to the manifest. `run` supports `string` or `string[]`.
- OSS `configBase` changes Vite output paths and manifest URLs.
- The package only supports ESM import syntax.

## Local Test Methods

Install dependencies first:

```bash
pnpm install
```

Basic checks:

```bash
pnpm typecheck
pnpm test -- --run
```

Playground build checks without upload:

```bash
pnpm build:test
```

FTP upload tests:

```bash
pnpm build:test:ftp
pnpm build:test:ftp-debug
pnpm deploy:test:ftp:api
pnpm deploy:test:ftp:cli
```

FTP test environment variables:

```bash
zH5FtpHost=xxx
zH5FtpPort=21
zH5FtpUser=xxx
zH5FtpPassword=xxx
zH5FtpAlias=https://example.com
```

OSS upload tests:

```bash
pnpm build:test:oss
pnpm build:test:oss-debug
pnpm deploy:test:oss:api
pnpm deploy:test:oss:cli
```

OSS test environment variables:

```bash
zAccessKeyId=xxx
zAccessKeySecret=xxx
zBucket=xxx
zBucketAlias=https://example.com
```

The upload test commands will really upload files. Only run them after confirming the environment variables and target paths.
