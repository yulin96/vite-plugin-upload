import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { appendCliValue, loadDeployConfig, readCliValue } from '../src/shared/cli'
import { renderDebugPanel } from '../src/shared/deploy-output'
import { normalizePathSegments, normalizeUrlLikeBase } from '../src/shared/path'
import { renderUploadProgress } from '../src/shared/terminal-reporter'
import { renderPanel } from '../src/shared/terminal'

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

test('adapts live upload progress to narrow terminals', () => {
  const snapshot = {
    completed: 5,
    totalFiles: 10,
    uploadedBytes: 1024,
    totalBytes: 2048,
    elapsedSeconds: 2,
  }

  expect(renderUploadProgress(snapshot, 50)).toContain('5/10')
  expect(renderUploadProgress(snapshot, 50)).not.toContain('1.0 KB/2.0 KB')
  expect(renderUploadProgress(snapshot, 100)).toContain('1.0 KB/2.0 KB')
})

test('wraps preserved panel values instead of truncating them', () => {
  const value = 'https://events.example.com/a/very/long/deployment/path/index.html'
  const output = renderPanel('部署完成', [{ label: '访问:', value, preserveValue: true }], 'success', undefined, 40)

  expect(output.split('\n')).toHaveLength(4)
  expect(output).not.toContain('…')
  expect(output).toContain('https://events.example.com/a/v')
  expect(output).toContain('.html')
})

test('does not add trailing spaces to panel rows', () => {
  const output = renderPanel('部署完成', [{ label: '结果:', value: '10/10 全部成功' }])

  expect(output.split('\n').every((line) => !line.endsWith(' '))).toBe(true)
})

test('compacts consecutive debug timings by group', () => {
  const output = renderDebugPanel([
    { label: '扫描本地文件', durationMs: 2, group: '前置操作' },
    { label: '预检连接', durationMs: 180, group: '前置操作' },
    { label: '上传墙钟耗时', durationMs: 7200 },
  ])

  expect(output).toContain('前置操作')
  expect(output).toContain('182ms')
  expect(output).not.toContain('扫描本地文件')
  expect(output).not.toContain('预检连接')
})
