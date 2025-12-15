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
