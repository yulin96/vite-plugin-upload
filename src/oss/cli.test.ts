import { beforeEach, expect, onTestFinished, test, vi } from 'vitest'

const cliMock = vi.hoisted(() => ({ deploy: vi.fn(), config: vi.fn() }))
vi.mock('./deploy', () => ({ deployOss: cliMock.deploy }))
vi.mock('../shared/cli', async (importOriginal) => ({
  ...await importOriginal<typeof import('../shared/cli')>(),
  loadDeployConfig: cliMock.config,
}))

beforeEach(() => {
  vi.resetModules()
  cliMock.deploy.mockReset().mockResolvedValue({ success: true })
  cliMock.config.mockReset().mockResolvedValue({ uploadDir: 'site', partSize: 1048576, multipartConcurrency: 4 })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const argv = process.argv
  const exitCode = process.exitCode
  process.exitCode = undefined
  onTestFinished(() => { process.argv = argv; process.exitCode = exitCode })
})

test('parses multipart numeric flags and overrides the loaded config', async () => {
  process.argv = ['node', 'deploy-oss', '--partSize', '4194304', '--multipartConcurrency', '2', '--multipartThreshold', '20971520']
  await import('./cli')
  await vi.waitFor(() => expect(cliMock.deploy).toHaveBeenCalledExactlyOnceWith({
    uploadDir: 'site', partSize: 4194304, multipartConcurrency: 2, multipartThreshold: 20971520,
  }))
  expect(process.exitCode).toBeUndefined()
})

test('rejects a missing numeric flag value without starting deployment', async () => {
  process.argv = ['node', 'deploy-oss', '--partSize']
  await import('./cli')
  await vi.waitFor(() => expect(process.exitCode).toBe(1))
  expect(console.error).toHaveBeenCalledExactlyOnceWith('--partSize requires a value')
  expect(cliMock.config).not.toHaveBeenCalled()
  expect(cliMock.deploy).not.toHaveBeenCalled()
})
