import { resolve } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'
import { deployOss } from './deploy'
import type { DeployOssOption, vitePluginDeployOssOption } from './types'
import {
  ensureTrailingSlash,
  normalizeSlash,
  normalizeUrlLikeBase,
  resolveManifestFileName,
  resolveRemoteManifestUrl,
} from './utils/path'

export { deployOss }
export const defineDeployConfig = (option: DeployOssOption): DeployOssOption => option
export type {
  DeployOssOption,
  DeployOssResult,
  ManifestConfig,
  ManifestFileItem,
  ManifestOption,
  ManifestPayload,
  UploadResult,
  UploadTask,
  vitePluginDeployOssOption,
} from './types'

export default function vitePluginDeployOss(option: vitePluginDeployOssOption): Plugin {
  const { open = false, configBase, alias, manifest, uploadDir } = option || {}

  let buildFailed = false
  let upload = false
  let outDir = normalizeSlash(resolve('dist'))
  let resolvedConfig: ResolvedConfig | null = null
  const normalizedConfigBase = configBase ? ensureTrailingSlash(normalizeUrlLikeBase(configBase)) : undefined
  const normalizedAlias = alias ? normalizeUrlLikeBase(alias) : undefined
  const manifestFileName = open ? resolveManifestFileName(manifest) : null
  const manifestUrl =
    manifestFileName ?
      resolveRemoteManifestUrl(manifestFileName, uploadDir, normalizedConfigBase, normalizedAlias)
    : null

  return {
    name: 'vite-plugin-deploy-oss',
    apply: 'build',
    enforce: 'post',
    buildEnd(error) {
      if (error) buildFailed = true
    },
    config(config) {
      if (!open || buildFailed) return

      upload = true
      config.base = normalizedConfigBase || config.base
      return config
    },
    configResolved(config) {
      resolvedConfig = config
      outDir = normalizeSlash(resolve(config.root, config.build.outDir))
    },
    transformIndexHtml: {
      order: 'post',
      handler() {
        if (!upload || buildFailed || !manifestUrl) return

        return [
          {
            tag: 'meta',
            attrs: {
              name: 'vite-plugin-upload-manifest',
              content: manifestUrl,
            },
            injectTo: 'head',
          },
        ]
      },
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      async handler() {
        if (!open || !upload || buildFailed || !resolvedConfig) return

        await deployOss({
          ...option,
          configBase: normalizedConfigBase,
          outDir,
        })
      },
    },
  }
}
