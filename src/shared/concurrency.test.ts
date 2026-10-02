import { expect, test } from 'vitest'
import { deferred } from '../../tests/helpers/upload'
import { mapWithConcurrency } from './concurrency'

test('bounds work and preserves input order when completion order differs', async () => {
  const releases = [deferred<string>(), deferred<string>(), deferred<string>()]
  const started: number[] = []
  const secondStarted = deferred()
  const thirdStarted = deferred()
  const work = mapWithConcurrency([0, 1, 2], 2, async (index) => {
    started.push(index)
    if (index === 1) secondStarted.resolve()
    if (index === 2) thirdStarted.resolve()
    return releases[index].promise
  })
  await secondStarted.promise
  expect(started).toEqual([0, 1])
  releases[1].resolve('second')
  await thirdStarted.promise
  expect(started).toEqual([0, 1, 2])
  releases[2].resolve('third')
  releases[0].resolve('first')
  expect(await work).toEqual(['first', 'second', 'third'])
})

test('waits for active work and stops starting new work after failure', async () => {
  const failure = new Error('read failed')
  const active = deferred<void>()
  const failed = deferred<void>()
  const started: number[] = []
  const work = mapWithConcurrency([0, 1, 2], 2, async (index) => {
    started.push(index)
    if (index === 0) { failed.resolve(); throw failure }
    await active.promise
    return index
  })
  let settled = false
  void work.then(() => { settled = true }, () => { settled = true })
  const result = expect(work).rejects.toBe(failure)
  await failed.promise
  await Promise.resolve()
  expect(settled).toBe(false)
  active.resolve()
  await result
  expect(started).toEqual([0, 1])
})

test('handles an empty input and rejects invalid concurrency', async () => {
  expect(await mapWithConcurrency([], 2, async () => 1)).toEqual([])
  await expect(mapWithConcurrency([1], 0, async () => 1)).rejects.toThrow('concurrency must be >= 1')
})
