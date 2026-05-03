const cacheResetters = new Set<() => void>()

export function registerCacheReset(reset: () => void): void {
  cacheResetters.add(reset)
}

export function resetRegisteredCaches(): void {
  for (const reset of cacheResetters) {
    reset()
  }
}
