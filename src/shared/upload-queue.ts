export const isHtmlFile = (name: string): boolean => /\.html?$/i.test(name)

export const createUploadQueue = <T>(tasks: T[], isEntry: (task: T) => boolean, preparationFailed = false) => {
  const assets = tasks.filter((task) => !isEntry(task))
  const entries = tasks.filter(isEntry)
  let assetIndex = 0
  let entryIndex = 0
  let pendingAssets = assets.length
  let assetFailed = preparationFailed
  let finishAssets!: () => void
  const assetsFinished = new Promise<void>((resolve) => { finishAssets = resolve })
  if (pendingAssets === 0) finishAssets()

  return {
    async next(): Promise<T | undefined> {
      if (assetIndex < assets.length) return assets[assetIndex++]
      await assetsFinished
      if (assetFailed) return undefined
      return entries[entryIndex++]
    },
    complete(task: T, success: boolean) {
      if (isEntry(task)) return
      if (!success) assetFailed = true
      if (--pendingAssets === 0) finishAssets()
    },
    skippedEntries: () => assetFailed ? entries : [],
  }
}
