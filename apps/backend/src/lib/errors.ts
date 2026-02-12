interface HttpErrorOptions {
  status: number
  code?: string
  cause?: Error
}

export class HttpError extends Error {
  readonly status: number
  readonly code?: string

  constructor(message: string, { status, code, cause }: HttpErrorOptions) {
    super(message, { cause })
    this.status = status
    this.code = code
    this.name = "HttpError"
  }
}

export class DuplicateSlugError extends HttpError {
  constructor(slug: string) {
    super(`Channel with slug "${slug}" already exists`, {
      status: 409,
      code: "DUPLICATE_SLUG",
    })
    this.name = "DuplicateSlugError"
  }
}

export class StreamNotFoundError extends HttpError {
  constructor() {
    super("Stream not found", {
      status: 404,
      code: "STREAM_NOT_FOUND",
    })
    this.name = "StreamNotFoundError"
  }
}

export class MessageNotFoundError extends HttpError {
  constructor() {
    super("Message not found", {
      status: 404,
      code: "MESSAGE_NOT_FOUND",
    })
    this.name = "MessageNotFoundError"
  }
}

/** Check if a PostgreSQL error is a unique constraint violation (code 23505). */
export function isUniqueViolation(error: unknown, constraintName?: string): boolean {
  if (!error || typeof error !== "object") return false
  const pgError = error as { code?: string; constraint?: string }
  if (pgError.code !== "23505") return false
  if (constraintName && pgError.constraint !== constraintName) return false
  return true
}
