// API Error class with structured error information
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = "ApiError"
  }

  static isApiError(error: unknown): error is ApiError {
    return error instanceof ApiError
  }
}

// Response type for error responses.
// Canonical shape emitted by the backend's `errorHandler` middleware
// (packages/backend-common/src/middleware/error-handler.ts) and matched by
// inline handler responses: `{ error: "<message>", code?: "<CODE>" }`.
interface ErrorResponse {
  error?: string
  code?: string
  details?: Record<string, unknown>
}

/**
 * Read an error response and return a typed `ApiError`. Use this from
 * raw `fetch` callers (multipart uploads) so they share `apiFetch`'s
 * error-shape handling instead of reimplementing it. A body that's
 * missing or unparseable falls back to the supplied defaults rather
 * than crashing.
 */
export async function parseApiError(
  response: Response,
  fallback: { code?: string; message?: string } = {}
): Promise<ApiError> {
  const body = (await response.json().catch(() => ({}))) as ErrorResponse
  const code = body.code || fallback.code || "UNKNOWN_ERROR"
  const message = body.error || fallback.message || `Request failed with status ${response.status}`
  return new ApiError(response.status, code, message, body.details)
}

/**
 * Base URL for API calls. Empty string for same-origin (dev/prod),
 * absolute URL for staging (e.g. "https://staging.threa.io").
 */
export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ""

// Bound every request so a flaky/slow network can't leave a fetch hanging
// forever — background revalidations must settle (to cached state) instead of
// piling up. Generous because it's a safety net, not a latency budget;
// override per-call via `options.timeoutMs`.
const DEFAULT_TIMEOUT_MS = 20000

export type ApiRequestInit = RequestInit & { timeoutMs?: number }

// Base fetch wrapper with error handling
async function apiFetch<T>(path: string, options: ApiRequestInit = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...init } = options

  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  const onCallerAbort = () => controller.abort()
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort()
    else callerSignal.addEventListener("abort", onCallerAbort, { once: true })
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include", // Include cookies for auth
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
      },
    })
  } catch (err) {
    // A timeout is a network-like failure, not an auth signal. Throw a plain
    // Error (NOT an ApiError) so `handleGlobalError` can't mistake it for a
    // 401 and bounce the user to login — queries fall back to cached/IDB
    // state instead. A caller-driven abort rethrows unchanged.
    if (timedOut) {
      throw new Error(`Request timed out after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timeout)
    if (callerSignal) callerSignal.removeEventListener("abort", onCallerAbort)
  }

  // Handle non-JSON responses (like 204 No Content)
  if (response.status === 204) {
    return undefined as T
  }

  if (!response.ok) {
    throw await parseApiError(response)
  }

  // Parse JSON success body. A malformed payload here is its own failure
  // mode (server lied about content-type), distinct from an error
  // response, so use a dedicated code so callers can tell them apart.
  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError(response.status, "PARSE_ERROR", "Failed to parse server response")
  }
}

// HTTP method helpers
export const api = {
  get<T>(path: string, options?: ApiRequestInit): Promise<T> {
    return apiFetch<T>(path, { ...options, method: "GET" })
  },

  post<T>(path: string, body?: unknown, options?: ApiRequestInit): Promise<T> {
    return apiFetch<T>(path, {
      ...options,
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    })
  },

  patch<T>(path: string, body?: unknown, options?: ApiRequestInit): Promise<T> {
    return apiFetch<T>(path, {
      ...options,
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    })
  },

  put<T>(path: string, body?: unknown, options?: ApiRequestInit): Promise<T> {
    return apiFetch<T>(path, {
      ...options,
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    })
  },

  delete<T>(path: string, options?: ApiRequestInit): Promise<T> {
    return apiFetch<T>(path, { ...options, method: "DELETE" })
  },
}

// Re-export for convenience
export default api
