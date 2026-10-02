export const mapWithConcurrency = async <T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T, index: number) => Promise<R>,
): Promise<R[]> => {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be >= 1')
  const results: R[] = new Array(values.length)
  let currentIndex = 0
  let failed = false
  let failure: unknown
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (!failed && currentIndex < values.length) {
      const index = currentIndex++
      try {
        results[index] = await map(values[index], index)
      } catch (error) {
        if (!failed) failure = error
        failed = true
      }
    }
  }))
  if (failed) throw failure
  return results
}
