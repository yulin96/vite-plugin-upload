import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { expect, test, vi } from 'vitest'
import { createUploadFixture } from '../../../tests/helpers/upload'
import { createZipFile, getFtpUploadFiles } from './file'

const zipMock = vi.hoisted(() => ({ error: new Error('ZIP source read failed') }))
vi.mock('yazl', () => ({
  default: { ZipFile: class extends EventEmitter {
    outputStream = new PassThrough()
    addFile() {}
    end() { queueMicrotask(() => this.emit('error', zipMock.error)) }
  } },
}))

test('rejects ZIP encoder errors through the promise instead of an uncaught event', async () => {
  const { outDir } = createUploadFixture({ 'a.js': 'abc' })
  await expect(createZipFile(outDir, join(outDir, 'backup.zip'))).rejects.toBe(zipMock.error)
  expect(readFileSync(join(outDir, 'a.js'), 'utf8')).toBe('abc')
})

test('keeps FTP file identity including whitespace and hidden files', () => {
  const { outDir } = createUploadFixture({ ' only.js ': 'abc', '.well-known/a.json': '{}' })
  expect(getFtpUploadFiles(outDir).sort()).toEqual([' only.js ', '.well-known/a.json'])
})
