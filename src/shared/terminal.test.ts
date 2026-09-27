import { expect, test } from 'vitest'
import { renderPanel } from './terminal'

test('wraps preserved panel values instead of truncating them', () => {
  const value = 'https://events.example.com/a/very/long/deployment/path/index.html'
  const output = renderPanel('部署完成', [{ label: '访问:', value, preserveValue: true }], 'success', undefined, 40)

  expect(output.split('\n')).toHaveLength(4)
  expect(output).not.toContain('…')
  expect(output).toContain('https://events.example.com/a/v')
  expect(output).toContain('.html')
})

test('keeps non-wrapping panel values on one physical line', () => {
  const value = 'https://events.example.com/a/very/long/deployment/path/oss-manifest.json'
  const output = renderPanel(
    '部署完成',
    [{ label: '清单:', value, preserveValue: true, wrapValue: false }],
    'success',
    undefined,
    40,
  )

  expect(output.split('\n')).toHaveLength(2)
  expect(output).toContain(value)
})

test('does not add trailing spaces to panel rows', () => {
  const output = renderPanel('部署完成', [{ label: '结果:', value: '10/10 全部成功' }])

  expect(output.split('\n').every((line) => !line.endsWith(' '))).toBe(true)
})
