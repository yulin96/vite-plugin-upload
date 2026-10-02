import type { Plugin } from 'vite'
import vitePluginDeployFtp, { defineDeployConfig as defineDeployFtpConfig, deployFtp } from './ftp'
import type { DeployFtpOption, vitePluginDeployFtpOption } from './ftp'
import vitePluginDeployOss, { defineDeployConfig as defineDeployOssConfig, deployOss } from './oss'
import type { DeployOssOption, vitePluginDeployOssOption } from './oss'
import type { DeployOssResult } from './oss/types'
import { cleanupOssUploads } from './oss/cleanup'

export {
  defineDeployFtpConfig,
  defineDeployOssConfig,
  deployFtp,
  deployOss,
  vitePluginDeployFtp,
  vitePluginDeployOss,
}
export const defineUploadConfig = (option: VitePluginUploadOption): VitePluginUploadOption => option
export type {
  DeployFtpOption,
  DeployOssOption,
  vitePluginDeployFtpOption,
  vitePluginDeployOssOption,
}

export interface VitePluginUploadOption {
  oss?: vitePluginDeployOssOption | false
  ftp?: vitePluginDeployFtpOption | false
}

export function vitePluginUpload(option: VitePluginUploadOption): Plugin[] {
  const plugins: Plugin[] = []
  const deferCleanup = Boolean(option.oss && option.oss.open && option.oss.autoDelete && !option.oss.manifest && option.ftp && option.ftp.open)
  let ossDeployment: DeployOssResult | undefined

  if (option.oss) {
    plugins.push(vitePluginDeployOss(
      deferCleanup ? { ...option.oss, autoDelete: false } : option.oss,
      deferCleanup ? (result) => { ossDeployment = result } : undefined,
    ))
  }

  if (option.ftp) {
    plugins.push(vitePluginDeployFtp(option.ftp, deferCleanup ? async (result) => {
      if (result.success && result.targets.length > 0 && ossDeployment?.success) {
        await cleanupOssUploads(ossDeployment)
        ossDeployment = undefined
      }
    } : undefined))
  }

  return plugins
}
