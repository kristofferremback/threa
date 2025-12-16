const DEFAULT_MAX_BACKOFF_MS = 5 * 60 * 1000 // 5 minutes

export interface BackoffOptions {
  baseMs: number
  retryCount: number
  maxMs?: number
  random?: () => number // injectable for testing
}

/**
 * Calculates exponential backoff with jitter.
 *
 * Formula: base * 2^(retry-1) + random(0, base)
 *
 * The jitter (random component) prevents thundering herd when multiple
 * processes retry simultaneously after a shared failure.
 */
export function calculateBackoffMs(options: BackoffOptions): number {
  const { baseMs, retryCount, maxMs = DEFAULT_MAX_BACKOFF_MS, random = Math.random } = options

  const exponential = baseMs * Math.pow(2, retryCount - 1)
  const jitter = random() * baseMs
  const backoffMs = exponential + jitter

  return Math.min(backoffMs, maxMs)
}
