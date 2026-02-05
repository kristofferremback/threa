/**
 * Text File Detection Utilities
 *
 * Functions for detecting binary vs text files, inferring format,
 * and normalizing encoding.
 */

import type { TextFormat } from "@threa/types"
import { BINARY_DETECTION, EXTENSION_FORMAT_MAP, getFileExtension } from "./config"

/**
 * Check if a buffer contains binary content.
 *
 * Detects binary files by:
 * 1. Checking for null bytes (common in binary files)
 * 2. Looking for invalid UTF-8 sequences
 *
 * @param buffer First few KB of the file
 * @returns true if file appears to be binary
 */
export function isBinaryFile(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, BINARY_DETECTION.checkSize)

  // Empty buffers are not binary (nothing to check)
  if (checkLength === 0) {
    return false
  }

  let nullByteCount = 0

  for (let i = 0; i < checkLength; i++) {
    const byte = buffer[i]

    // Null bytes are a strong indicator of binary content
    if (byte === 0) {
      nullByteCount++
    }
  }

  // If more than 1% null bytes, likely binary
  if (nullByteCount / checkLength > BINARY_DETECTION.nullByteThreshold) {
    return true
  }

  // Try to decode as UTF-8 - if it fails, likely binary
  try {
    const text = buffer.slice(0, checkLength).toString("utf-8")
    // Check for replacement characters (invalid UTF-8 sequences become U+FFFD)
    const replacementCount = (text.match(/\uFFFD/g) || []).length
    // Allow some replacement characters (could be legitimate in text)
    if (replacementCount / text.length > 0.01) {
      return true
    }
  } catch {
    // If UTF-8 decoding throws, it's definitely binary
    return true
  }

  return false
}

/**
 * Detect the encoding of a buffer and normalize to UTF-8.
 *
 * Handles:
 * - UTF-8 (with or without BOM)
 * - UTF-16 LE/BE (with BOM)
 * - ASCII (subset of UTF-8)
 *
 * @param buffer File content
 * @returns Object with normalized text and detected encoding
 */
export function normalizeEncoding(buffer: Buffer): { text: string; encoding: string } {
  // Check for BOM (Byte Order Mark)
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    // UTF-8 BOM
    return { text: buffer.slice(3).toString("utf-8"), encoding: "utf-8-bom" }
  }

  if (buffer.length >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      // UTF-16 LE BOM
      return { text: buffer.slice(2).toString("utf16le"), encoding: "utf-16le" }
    }
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      // UTF-16 BE BOM - convert to string
      // Node doesn't have utf16be, so we need to swap bytes
      const swapped = Buffer.alloc(buffer.length - 2)
      for (let i = 2; i < buffer.length - 1; i += 2) {
        swapped[i - 2] = buffer[i + 1]
        swapped[i - 1] = buffer[i]
      }
      return { text: swapped.toString("utf16le"), encoding: "utf-16be" }
    }
  }

  // Default to UTF-8
  return { text: buffer.toString("utf-8"), encoding: "utf-8" }
}

/**
 * Infer the text format from filename and content.
 *
 * Priority:
 * 1. Extension-based detection (reliable)
 * 2. Content heuristics (fallback)
 * 3. Default to 'plain'
 *
 * @param filename File name
 * @param content File content (first few lines)
 * @returns Detected format
 */
export function inferFormat(filename: string, content: string): TextFormat {
  const ext = getFileExtension(filename.toLowerCase())

  // Extension-based detection
  if (ext && EXTENSION_FORMAT_MAP[ext]) {
    return EXTENSION_FORMAT_MAP[ext]
  }

  // Content heuristics for common formats
  const trimmedContent = content.trim()

  // JSON detection
  if (
    (trimmedContent.startsWith("{") && trimmedContent.includes(":")) ||
    (trimmedContent.startsWith("[") && (trimmedContent.includes("{") || trimmedContent.includes('"')))
  ) {
    try {
      JSON.parse(trimmedContent.slice(0, 1000)) // Try parsing first 1KB
      return "json"
    } catch {
      // Not valid JSON, continue checking
    }
  }

  // YAML detection
  if (trimmedContent.startsWith("---") || /^[a-zA-Z_][a-zA-Z0-9_]*:\s/m.test(trimmedContent)) {
    // Check for YAML-like structure (key: value pairs)
    const yamlLikeLines = trimmedContent.split("\n").filter((line) => /^[a-zA-Z_][a-zA-Z0-9_]*:\s/.test(line))
    if (yamlLikeLines.length >= 2) {
      return "yaml"
    }
  }

  // CSV detection (comma-separated with consistent column count)
  const lines = trimmedContent.split("\n").slice(0, 5)
  if (lines.length >= 2) {
    const columnCounts = lines.map((line) => line.split(",").length)
    const allSame = columnCounts.every((count) => count === columnCounts[0] && count >= 2)
    if (allSame) {
      return "csv"
    }
  }

  // Markdown detection
  if (
    /^#{1,6}\s/.test(trimmedContent) || // Headings
    /^\*\*.*\*\*/.test(trimmedContent) || // Bold
    /^\[.*\]\(.*\)/.test(trimmedContent) || // Links
    /^```/.test(trimmedContent) // Code blocks
  ) {
    return "markdown"
  }

  // Default to plain text
  return "plain"
}
