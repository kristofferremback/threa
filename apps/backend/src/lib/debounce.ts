/**
 * Debounce utility with maximum wait time
 *
 * Ensures the callback is called:
 * - After `debounceMs` milliseconds of inactivity (standard debounce)
 * - Or after `maxWaitMs` milliseconds from the first trigger (prevents indefinite delays)
 */
export class DebounceWithMaxWait {
  private debounceTimer: Timer | null = null
  private maxWaitTimer: Timer | null = null
  private firstTriggerTime: number | null = null

  constructor(
    private callback: () => void | Promise<void>,
    private debounceMs: number,
    private maxWaitMs: number,
    private onError?: (error: unknown) => void,
  ) {}

  trigger(): void {
    const isFirstInBatch = this.firstTriggerTime === null

    if (isFirstInBatch) {
      this.firstTriggerTime = Date.now()
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.clearMaxWaitTimer()
      this.executeCallback()
    }, this.debounceMs)

    if (isFirstInBatch) {
      this.maxWaitTimer = setTimeout(() => {
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer)
          this.debounceTimer = null
        }
        this.clearMaxWaitTimer()
        this.executeCallback()
      }, this.maxWaitMs)
    }
  }

  cancel(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.clearMaxWaitTimer()
  }

  private executeCallback(): void {
    try {
      const result = this.callback()
      if (result instanceof Promise) {
        result.catch((error) => {
          if (this.onError) {
            this.onError(error)
          }
        })
      }
    } catch (error) {
      if (this.onError) {
        this.onError(error)
      }
    }
  }

  private clearMaxWaitTimer(): void {
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer)
      this.maxWaitTimer = null
    }
    this.firstTriggerTime = null
  }
}
