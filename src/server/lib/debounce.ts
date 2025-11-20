/**
 * Debounce utility with maximum wait time
 *
 * Ensures the callback is called:
 * - After `debounceMs` milliseconds of inactivity (standard debounce)
 * - Or after `maxWaitMs` milliseconds from the first trigger (prevents indefinite delays)
 *
 * Useful for batching rapid events while ensuring they're processed within a reasonable time.
 */
export class DebounceWithMaxWait {
  private debounceTimer: NodeJS.Timeout | null = null
  private maxWaitTimer: NodeJS.Timeout | null = null
  private firstTriggerTime: number | null = null

  constructor(
    private callback: () => void | Promise<void>,
    private debounceMs: number,
    private maxWaitMs: number,
    private onError?: (error: unknown) => void,
  ) {}

  /**
   * Trigger the debounced callback
   * Resets the debounce timer, and sets max wait timer on first trigger
   */
  trigger(): void {
    const isFirstInBatch = this.firstTriggerTime === null

    // Track when this batch started
    if (isFirstInBatch) {
      this.firstTriggerTime = Date.now()
    }

    // Debounce: clear existing timer and set a new one
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.clearMaxWaitTimer()
      this.executeCallback()
    }, this.debounceMs)

    // Set max wait timer on first trigger in batch
    if (isFirstInBatch) {
      this.maxWaitTimer = setTimeout(() => {
        // Force execution after max wait time
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer)
          this.debounceTimer = null
        }
        this.clearMaxWaitTimer()
        this.executeCallback()
      }, this.maxWaitMs)
    }
  }

  /**
   * Cancel any pending debounce timers
   */
  cancel(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.clearMaxWaitTimer()
  }

  /**
   * Execute the callback and handle errors
   */
  private executeCallback(): void {
    try {
      const result = this.callback()
      // Handle promise if callback is async
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

  /**
   * Clear max wait timer and reset batch tracking
   */
  private clearMaxWaitTimer(): void {
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer)
      this.maxWaitTimer = null
    }
    this.firstTriggerTime = null
  }
}
