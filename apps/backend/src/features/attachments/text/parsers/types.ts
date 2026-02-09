/**
 * Parser Types
 *
 * Shared interfaces for text file parsers.
 */

import type {
  TextFormat,
  TextSection,
  MarkdownStructure,
  JsonStructure,
  CsvStructure,
  CodeStructure,
} from "@threa/types"

/**
 * Result of parsing a text file.
 */
export interface ParseResult {
  /** Detected/confirmed format */
  format: TextFormat
  /** Sections for navigation */
  sections: TextSection[]
  /** Format-specific structure (null for plain text) */
  structure: MarkdownStructure | JsonStructure | CsvStructure | CodeStructure | null
  /** Preview content for summarization (first N lines) */
  previewContent: string
  /** Total line count */
  totalLines: number
}

/**
 * Parser interface for text file formats.
 */
export interface TextParser {
  /**
   * Parse text content and extract structure.
   *
   * @param content File content
   * @param filename Original filename (for context)
   * @returns Parse result with sections and structure
   */
  parse(content: string, filename: string): ParseResult
}
