import { expect, test } from 'vitest'
import { createUploadQueue, isHtmlFile } from './upload-queue'

test('waits for every asset before releasing HTML', async () => {
  const queue = createUploadQueue(['index.html', 'a.js', 'b.js'], isHtmlFile)
  expect(await queue.next()).toBe('a.js')
  expect(await queue.next()).toBe('b.js')
  const entry = queue.next()
  queue.complete('b.js', true)
  queue.complete('a.js', true)
  expect(await entry).toBe('index.html')
  expect(await queue.next()).toBeUndefined()
  expect(queue.skippedEntries()).toEqual([])
})

test.each([true, false])('retains skipped HTML when preparationFailed=%s', async (preparationFailed) => {
  const queue = createUploadQueue(['index.html', 'a.js', 'pages/entry.HTML'], isHtmlFile, preparationFailed)
  expect(await queue.next()).toBe('a.js')
  queue.complete('a.js', false)
  expect(await queue.next()).toBeUndefined()
  expect(queue.skippedEntries()).toEqual(['index.html', 'pages/entry.HTML'])
})

test('supports HTML-only output and recognizes htm entries', async () => {
  const queue = createUploadQueue(['index.htm'], isHtmlFile)
  expect(await queue.next()).toBe('index.htm')
  queue.complete('index.htm', true)
  expect(await queue.next()).toBeUndefined()
})
