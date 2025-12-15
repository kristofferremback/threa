export class DuplicateSlugError extends Error {
  readonly code = "DUPLICATE_SLUG"

  constructor(slug: string) {
    super(`Channel with slug "${slug}" already exists`)
    this.name = "DuplicateSlugError"
  }
}

export class StreamNotFoundError extends Error {
  readonly code = "STREAM_NOT_FOUND"

  constructor() {
    super("Stream not found")
    this.name = "StreamNotFoundError"
  }
}
