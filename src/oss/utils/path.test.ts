import { expect, test } from 'vitest'
import { normalizeManifestFileName, resolveManifestFileName, resolveRemoteManifestUrl, resolveUploadedFileUrl } from './path'

test.each(['../outside.json', 'nested/../../outside.json', '/tmp/outside.json', 'C:\\outside.json', './manifest.json', '', '   '])(
  'rejects unsafe manifest path %j', (name) => {
    expect(() => normalizeManifestFileName(name)).toThrow('manifest.fileName')
  },
)

test('normalizes nested manifest paths and handles disabled/default manifests', () => {
  expect(normalizeManifestFileName(' metadata\\nested//manifest.json ')).toBe('metadata/nested/manifest.json')
  expect(resolveManifestFileName(false)).toBeNull()
  expect(resolveManifestFileName(true)).toBe('oss-manifest.json')
  expect(resolveManifestFileName({})).toBe('oss-manifest.json')
})

test('prefers configBase and encodes path segments exactly once', () => {
  expect(resolveUploadedFileUrl('中文/a%20b#?.js', 'assets/unused', 'https://cdn.example.com/', 'https://alias.example.com'))
    .toBe('https://cdn.example.com/%E4%B8%AD%E6%96%87/a%2520b%23%3F.js')
  expect(resolveUploadedFileUrl('a.js', 'assets/a.js', undefined, 'https://alias.example.com/'))
    .toBe('https://alias.example.com/assets/a.js')
  expect(resolveUploadedFileUrl('a.js', 'assets/a.js')).toBe('assets/a.js')
})

test.each(['/assets', '//cdn.example.com', 'ftp://cdn.example.com'])('rejects non-HTTP public manifest URL %s', (base) => {
  expect(() => resolveRemoteManifestUrl('manifest.json', 'assets', base)).toThrow('absolute http(s)')
})
