export class DuplicateSlugError extends Error {
  readonly code = "DUPLICATE_SLUG"

  constructor(slug: string) {
    super(`Channel with slug "${slug}" already exists`)
    this.name = "DuplicateSlugError"
  }
}
