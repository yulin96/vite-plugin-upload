import { expect, test } from 'vitest'
import { renderDebugPanel } from './deploy-output'

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
