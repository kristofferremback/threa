/**
 * Type declarations for word-extractor package.
 * This package doesn't include TypeScript types.
 */
declare module "word-extractor" {
  interface Document {
    getBody(): string
    getFootnotes(): string
    getEndnotes(): string
    getHeaders(): string[]
    getFooters(): string[]
    getAnnotations(): string[]
  }

  class WordExtractor {
    extract(input: Buffer | string): Promise<Document>
  }

  export = WordExtractor
}
