/**
 * Debounce utility with maximum wait time
 *
 * Ensures the callback is called:
 * - After `debounceMs` milliseconds of inactivity (standard debounce)
 * - Or after `maxWaitMs` milliseconds from the first trigger (prevents indefinite delays)
 *
 * Handles async callbacks by blocking new batches until the current callback completes.
 */
export class DebounceWithMaxWait {
  private debounceTimer: Timer | null = null
  private maxWaitTimer: Timer | null = null
  private firstTriggerTime: number | null = null
  private isExecuting = false
  private pendingTrigger = false

  constructor(
    private callback: () => void | Promise<void>,
    private debounceMs: number,
    private maxWaitMs: number,
    private onError?: (error: unknown) => void,
  ) {}

  trigger(): void {
    // If currently executing, queue a trigger for after completion
    if (this.isExecuting) {
      this.pendingTrigger = true
      return
    }

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
    this.pendingTrigger = false
  }

  private executeCallback(): void {
    // Guard against race condition when both timers fire in same event loop tick
    if (this.isExecuting) {
      return
    }
    this.isExecuting = true

    try {
      const result = this.callback()
      if (result instanceof Promise) {
        result
          .catch((error) => {
            if (this.onError) {
              this.onError(error)
            }
          })
          .finally(() => {
            this.onExecutionComplete()
          })
      } else {
        this.onExecutionComplete()
      }
    } catch (error) {
      if (this.onError) {
        this.onError(error)
      }
      this.onExecutionComplete()
    }
  }

  private onExecutionComplete(): void {
    this.isExecuting = false

    if (this.pendingTrigger) {
      this.pendingTrigger = false
      this.trigger()
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
