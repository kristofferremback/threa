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

// Response type for error responses
interface ErrorResponse {
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

// Base fetch wrapper with error handling
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
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
      body.error?.code || "UNKNOWN_ERROR",
      body.error?.message || `Request failed with status ${response.status}`,
      body.error?.details
    )
  }

  return body as T
}

// HTTP method helpers
export const api = {
  get<T>(path: string): Promise<T> {
    return apiFetch<T>(path, { method: "GET" })
  },

  post<T>(path: string, body?: unknown): Promise<T> {
    return apiFetch<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    })
  },

  patch<T>(path: string, body?: unknown): Promise<T> {
    return apiFetch<T>(path, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    })
  },

  put<T>(path: string, body?: unknown): Promise<T> {
    return apiFetch<T>(path, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    })
  },

  delete<T>(path: string): Promise<T> {
    return apiFetch<T>(path, { method: "DELETE" })
  },
}

// Re-export for convenience
export default api
