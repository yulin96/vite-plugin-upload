import { expect, test } from 'vitest'
import { normalizePathSegments, normalizeSlash, normalizeUrlLikeBase } from './path'

test('preserves shared path normalization behavior', () => {
  expect(normalizePathSegments('/assets/', 'nested\\file.js')).toBe('assets/nested/file.js')
  expect(normalizeUrlLikeBase('https://cdn.example.com//assets/')).toBe('https://cdn.example.com/assets')
  expect(normalizeUrlLikeBase('//cdn.example.com//assets/')).toBe('//cdn.example.com/assets')
  expect(normalizeUrlLikeBase('/assets/')).toBe('/assets')
})

test('preserves whitespace in file paths and object keys', () => {
  expect(normalizeSlash(' folder\\only.js ')).toBe(' folder/only.js ')
  expect(normalizePathSegments('assets', ' only.js ')).toBe('assets/ only.js ')
})
