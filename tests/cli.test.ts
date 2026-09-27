import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { loadDeployConfig } from '../src/shared/cli'

test('loads JSON and named-export deployment configs', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-config-'))
  const jsonPath = join(tempDir, 'deploy.json')
  const modulePath = join(tempDir, 'deploy.mjs')
  writeFileSync(jsonPath, JSON.stringify({ outDir: 'json-dist' }))
  writeFileSync(modulePath, "export const deployOss = { outDir: 'module-dist' }\n")

  try {
    await expect(loadDeployConfig(jsonPath, [], 'deployOss')).resolves.toEqual({ outDir: 'json-dist' })
    await expect(loadDeployConfig(modulePath, [], 'deployOss')).resolves.toEqual({ outDir: 'module-dist' })
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('loads the first existing default config and prioritizes an explicit config', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-config-'))
  const first = join(dir, 'first.json')
  const second = join(dir, 'second.json')
  writeFileSync(first, JSON.stringify({ outDir: 'first' }))
  writeFileSync(second, JSON.stringify({ outDir: 'second' }))
  try {
    await expect(loadDeployConfig(undefined, [join(dir, 'missing.json'), first, second], 'deployOss')).resolves.toEqual({ outDir: 'first' })
    await expect(loadDeployConfig(second, [first], 'deployOss')).resolves.toEqual({ outDir: 'second' })
    await expect(loadDeployConfig(undefined, [join(dir, 'missing.json')], 'deployOss')).resolves.toEqual({})
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('prefers the default module export and surfaces malformed JSON', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-config-'))
  const modulePath = join(dir, 'deploy.mjs')
  const jsonPath = join(dir, 'invalid.json')
  writeFileSync(modulePath, "export default { outDir: 'default' }; export const deployOss = { outDir: 'named' }")
  writeFileSync(jsonPath, '{invalid')
  try {
    await expect(loadDeployConfig(modulePath, [], 'deployOss')).resolves.toEqual({ outDir: 'default' })
    await expect(loadDeployConfig(jsonPath, [], 'deployOss')).rejects.toThrow(SyntaxError)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
