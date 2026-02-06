/**
 * Excel Document Format Detection
 *
 * Detects Excel document format using magic bytes rather than file extension.
 */

import { EXCEL_MAGIC_BYTES } from "./config"

export type ExcelFormat = "xlsx" | "xls"

/**
 * Detect Excel document format from file buffer using magic bytes.
 *
 * @param buffer - First 4+ bytes of the file
 * @returns Detected format or null if not a recognized Excel document
 */
export function detectExcelFormat(buffer: Buffer): ExcelFormat | null {
  if (buffer.length < 4) {
    return null
  }

  // Check for XLSX/XLSM (ZIP archive starting with PK)
  if (matchesMagicBytes(buffer, EXCEL_MAGIC_BYTES.xlsx)) {
    return "xlsx"
  }

  // Check for XLS (OLE compound document)
  if (matchesMagicBytes(buffer, EXCEL_MAGIC_BYTES.xls)) {
    return "xls"
  }

  return null
}

/**
 * Check if buffer starts with the given magic bytes.
 */
function matchesMagicBytes(buffer: Buffer, magicBytes: readonly number[]): boolean {
  for (let i = 0; i < magicBytes.length; i++) {
    if (buffer[i] !== magicBytes[i]) {
      return false
    }
  }
  return true
}

/**
 * Validate that a buffer is a valid Excel document.
 *
 * @param buffer - File buffer to validate
 * @returns Validated format or throws if invalid
 */
export function validateExcelFormat(buffer: Buffer): ExcelFormat {
  const format = detectExcelFormat(buffer)
  if (!format) {
    throw new Error("Invalid Excel document: unrecognized file format")
  }
  return format
}
