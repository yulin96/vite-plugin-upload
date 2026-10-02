import { type Client, FileType } from 'basic-ftp'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, test, vi } from 'vitest'
import { createBackupFile, createSingleBackup } from './backup'

const createClient = () => ({
  list: vi.fn(), downloadTo: vi.fn(), uploadFrom: vi.fn(),
})

test('skips nonexistent selected files and directories without downloading them', async () => {
  const client = createClient()
  client.list.mockResolvedValue([{ name: 'other.js', type: FileType.File }])
  expect(await createSingleBackup(client as unknown as Client, '/site', '', ['index.html', 'missing/page.html'])).toBeNull()
  expect(client.list).toHaveBeenCalledExactlyOnceWith('/site')
  expect(client.downloadTo).not.toHaveBeenCalled()
  expect(client.uploadFrom).not.toHaveBeenCalled()
})

test('backs up a nested selected file once and removes its local temporary copy', async () => {
  const client = createClient()
  client.list.mockImplementation(async (dir: string) => dir === '/site' ?
    [{ name: 'pages', type: FileType.Directory }]
    : [{ name: 'index.html', type: FileType.File }])
  client.downloadTo.mockImplementation(async (file: string) => writeFileSync(file, 'old HTML'))
  client.uploadFrom.mockImplementation(async (file: string) => expect(readFileSync(file, 'utf8')).toBe('old HTML'))
  const result = await createSingleBackup(client as unknown as Client, '/site', '', ['pages/index.html', 'pages/index.html'])
  expect(result?.items).toHaveLength(1)
  expect(result?.items[0]).toMatch(/^\/site\/pages\/index\.\d{8}_\d{6}\.html$/)
  expect(client.downloadTo).toHaveBeenCalledExactlyOnceWith(expect.any(String), '/site/pages/index.html')
  expect(client.uploadFrom).toHaveBeenCalledExactlyOnceWith(client.downloadTo.mock.calls[0]?.[0], result?.items[0])
  expect(existsSync(client.downloadTo.mock.calls[0]?.[0])).toBe(false)
})

test.each(['download', 'upload'] as const)('propagates selected-file backup %s failures', async (stage) => {
  const client = createClient()
  client.list.mockResolvedValue([{ name: 'index.html', type: FileType.File }])
  client.downloadTo.mockImplementation(async (file: string) => writeFileSync(file, 'old HTML'))
  const failure = new Error(`${stage} denied`)
  if (stage === 'download') client.downloadTo.mockRejectedValue(failure)
  else client.uploadFrom.mockRejectedValue(failure)
  await expect(createSingleBackup(client as unknown as Client, '/site', '', ['index.html'])).rejects.toMatchObject({
    message: `Failed to back up index.html: ${stage} denied`, cause: failure,
  })
  if (stage === 'download') expect(client.uploadFrom).not.toHaveBeenCalled()
  expect(existsSync(client.downloadTo.mock.calls[0]?.[0])).toBe(false)
})

test('creates a complete remote ZIP backup and cleans its temporary files', async () => {
  const client = createClient()
  client.list.mockResolvedValue([{ name: 'index.html', type: FileType.File, size: 8 }])
  client.downloadTo.mockImplementation(async (file: string) => writeFileSync(file, 'old HTML'))
  client.uploadFrom.mockImplementation(async (file: string, name: string) => {
    const zip = readFileSync(file)
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    expect(zip.subarray(-22, -18)).toEqual(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    expect(zip.includes(Buffer.from('index.html'))).toBe(true)
    expect(name).toMatch(/^\/site\/backup_\d{8}_\d{6}\.zip$/)
  })
  const result = await createBackupFile(client as unknown as Client, '/site', '')
  expect(result).toEqual({ title: '备份完成', items: [client.uploadFrom.mock.calls[0]?.[1]] })
  expect(client.uploadFrom).toHaveBeenCalledTimes(1)
  expect(existsSync(client.uploadFrom.mock.calls[0]?.[0])).toBe(false)
  expect(existsSync(client.downloadTo.mock.calls[0]?.[0])).toBe(false)
})
