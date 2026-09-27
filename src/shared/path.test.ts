import { expect, test } from 'vitest'
import { normalizePathSegments, normalizeUrlLikeBase } from './path'

test('preserves shared path normalization behavior', () => {
  expect(normalizePathSegments('/assets/', 'nested\\file.js')).toBe('assets/nested/file.js')
  expect(normalizeUrlLikeBase('https://cdn.example.com//assets/')).toBe('https://cdn.example.com/assets')
  expect(normalizeUrlLikeBase('//cdn.example.com//assets/')).toBe('//cdn.example.com/assets')
  expect(normalizeUrlLikeBase('/assets/')).toBe('/assets')
})
