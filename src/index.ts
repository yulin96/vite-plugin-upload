import type { Plugin } from 'vite'
import vitePluginDeployFtp, { defineDeployConfig as defineDeployFtpConfig, deployFtp } from './ftp'
import type { DeployFtpOption, vitePluginDeployFtpOption } from './ftp'
import vitePluginDeployOss, { defineDeployConfig as defineDeployOssConfig, deployOss } from './oss'
import type { DeployOssOption, vitePluginDeployOssOption } from './oss'

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

  if (option.oss) {
    plugins.push(vitePluginDeployOss(option.oss))
  }

  if (option.ftp) {
    plugins.push(vitePluginDeployFtp(option.ftp))
  }

  return plugins
}
