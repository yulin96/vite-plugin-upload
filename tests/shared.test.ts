import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { appendCliValue, loadDeployConfig, readCliValue } from '../src/shared/cli'
import { normalizePathSegments, normalizeUrlLikeBase } from '../src/shared/path'

test('preserves shared path normalization behavior', () => {
  expect(normalizePathSegments('/assets/', 'nested\\file.js')).toBe('assets/nested/file.js')
  expect(normalizeUrlLikeBase('https://cdn.example.com//assets/')).toBe('https://cdn.example.com/assets')
  expect(normalizeUrlLikeBase('//cdn.example.com//assets/')).toBe('//cdn.example.com/assets')
  expect(normalizeUrlLikeBase('/assets/')).toBe('/assets')
})

test('shares CLI value parsing and repeated option handling', () => {
  expect(readCliValue(['--outDir', 'dist'], 0, '--outDir')).toBe('dist')
  expect(() => readCliValue(['--outDir'], 0, '--outDir')).toThrow('--outDir requires a value')
  expect(appendCliValue(appendCliValue(undefined, 'a'), 'b')).toEqual(['a', 'b'])
})

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
