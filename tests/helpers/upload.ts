import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { onTestFinished } from 'vitest'

export const createUploadFixture = (files: Record<string, string | Buffer> = {}) => {
  const outDir = mkdtempSync(join(tmpdir(), 'vite-plugin-upload-'))
  onTestFinished(() => rmSync(outDir, { recursive: true, force: true }))
  for (const [name, content] of Object.entries(files)) {
    const filePath = join(outDir, name)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content)
  }
  return { outDir }
}

export const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
