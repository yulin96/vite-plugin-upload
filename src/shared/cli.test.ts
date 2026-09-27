import { expect, test } from 'vitest'
import { appendCliValue, readCliValue } from './cli'

test('shares CLI value parsing and repeated option handling', () => {
  expect(readCliValue(['--outDir', 'dist'], 0, '--outDir')).toBe('dist')
  expect(() => readCliValue(['--outDir'], 0, '--outDir')).toThrow('--outDir requires a value')
  expect(appendCliValue(appendCliValue(undefined, 'a'), 'b')).toEqual(['a', 'b'])
})

test.each([[], ['--outDir'], ['--outDir', '--debug'], ['--outDir', '']].map((args) => ({ args })))('rejects missing CLI values $args', ({ args }) => {
  expect(() => readCliValue(args, 0, '--outDir')).toThrow('--outDir requires a value')
})

test('appends repeated options without mutating the previous array', () => {
  const previous = ['a', 'b']
  expect(appendCliValue(previous, 'c')).toEqual(['a', 'b', 'c'])
  expect(previous).toEqual(['a', 'b'])
})
