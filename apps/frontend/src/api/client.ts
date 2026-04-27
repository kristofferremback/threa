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
 * Base URL for API calls. Empty string for same-origin (dev/prod),
 * absolute URL for staging (e.g. "https://staging.threa.io").
 */
export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ""

// Base fetch wrapper with error handling
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include", // Include cookies for auth
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  })

  // Handle non-JSON responses (like 204 No Content)
  if (response.status === 204) {
    return undefined as T
  }

  // Parse JSON response
  let body: T & ErrorResponse
  try {
    body = await response.json()
  } catch {
    throw new ApiError(response.status, "PARSE_ERROR", "Failed to parse server response")
  }

  // Handle error responses
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body.code || "UNKNOWN_ERROR",
      body.error || `Request failed with status ${response.status}`,
      body.details
    )
  }

  return body as T
}

// HTTP method helpers
export const api = {
  get<T>(path: string, options?: RequestInit): Promise<T> {
    return apiFetch<T>(path, { ...options, method: "GET" })
  },

  post<T>(path: string, body?: unknown, options?: RequestInit): Promise<T> {
    return apiFetch<T>(path, {
      ...options,
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    })
  },

  patch<T>(path: string, body?: unknown, options?: RequestInit): Promise<T> {
    return apiFetch<T>(path, {
      ...options,
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    })
  },

  put<T>(path: string, body?: unknown, options?: RequestInit): Promise<T> {
    return apiFetch<T>(path, {
      ...options,
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    })
  },

  delete<T>(path: string, options?: RequestInit): Promise<T> {
    return apiFetch<T>(path, { ...options, method: "DELETE" })
  },
}

// Re-export for convenience
export default api
