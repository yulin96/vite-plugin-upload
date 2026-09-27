import { expect, test } from 'vitest'
import { renderUploadProgress } from './terminal-reporter'

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
