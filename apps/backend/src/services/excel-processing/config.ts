/**
 * Excel Processing Configuration
 *
 * Central configuration for Excel workbook analysis and extraction.
 * Used by ExcelProcessingService and future evals.
 */

import { z } from "zod"
import { TEXT_SIZE_TIERS, INJECTION_STRATEGIES } from "@threa/types"

// ============================================================================
// Model Configuration
// ============================================================================

/**
 * Model for workbook summarization (large files only).
 * Gemini 2.5 Flash is fast and cheap for text summarization.
 */
export const EXCEL_SUMMARY_MODEL_ID = "openrouter:google/gemini-2.5-flash"

/**
 * Temperature for workbook summarization.
 * Slightly higher for creative summarization.
 */
export const EXCEL_SUMMARY_TEMPERATURE = 0.3

// ============================================================================
// MIME Types and Extensions
// ============================================================================

/**
 * MIME types for Excel documents.
 */
export const EXCEL_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "application/vnd.ms-excel.sheet.macroEnabled.12", // .xlsm
] as const

/**
 * File extensions for Excel documents.
 */
export const EXCEL_EXTENSIONS = [".xlsx", ".xls", ".xlsm"] as const

/**
 * Magic bytes for format detection.
 * Note: xlsx shares PK magic bytes with docx (both are ZIP archives).
 * Format detection after routing uses internal ZIP structure to distinguish.
 */
export const EXCEL_MAGIC_BYTES = {
  /** XLSX/XLSM: ZIP archive starting with PK (0x50 0x4B) */
  xlsx: [0x50, 0x4b, 0x03, 0x04] as const,
  /** XLS: OLE compound document */
  xls: [0xd0, 0xcf, 0x11, 0xe0] as const,
} as const

// ============================================================================
// Size Thresholds
// ============================================================================

/**
 * Size thresholds based on total cells across all sheets.
 * Tabular data is dense, so cell count is more meaningful than byte count.
 */
export const EXCEL_SIZE_THRESHOLDS = {
  /** Small workbooks (<5K cells): inject all sheets in full */
  smallCells: 5_000,
  /** Medium workbooks (5K-20K cells): inject all sheets, sample large ones */
  mediumCells: 20_000,
  /** Large workbooks (>20K cells): sheet summaries + sample, load_excel_section tool for detail */
} as const

/**
 * Sheet-level thresholds for row inclusion strategy.
 */
export const EXCEL_SHEET_THRESHOLDS = {
  /** Sheets with <= this many rows are always included in full regardless of workbook size */
  alwaysFullRows: 100,
  /** Sheets with > this many rows are always sampled, never included in full */
  alwaysSampleRows: 1_000,
} as const

/**
 * Number of sample rows to display for column preview.
 */
export const EXCEL_SAMPLE_ROWS = 5

/**
 * Maximum rows returned per load_excel_section request.
 */
export const EXCEL_MAX_ROWS_PER_REQUEST = 500

// ============================================================================
// Format Detection
// ============================================================================

/**
 * Check if a file is an Excel document based on MIME type and filename.
 *
 * - If mimeType matches Excel MIME types, return true
 * - If mimeType is "application/octet-stream", check file extension
 * - Otherwise return false
 */
export function isExcelAttachment(mimeType: string, filename: string): boolean {
  if (EXCEL_MIME_TYPES.includes(mimeType as (typeof EXCEL_MIME_TYPES)[number])) {
    return true
  }

  if (mimeType === "application/octet-stream") {
    const lowerFilename = filename.toLowerCase()
    return EXCEL_EXTENSIONS.some((ext) => lowerFilename.endsWith(ext))
  }

  return false
}

// ============================================================================
// Schemas
// ============================================================================

/**
 * Schema for Excel format.
 */
export const excelFormatSchema = z.enum(["xlsx", "xls"])

/**
 * Schema for size tier.
 */
export const sizeTierSchema = z.enum(TEXT_SIZE_TIERS)

/**
 * Schema for injection strategy.
 */
export const injectionStrategySchema = z.enum(INJECTION_STRATEGIES)

/**
 * Schema for sheet info.
 */
export const excelSheetInfoSchema = z.object({
  name: z.string(),
  rows: z.number(),
  columns: z.number(),
  headers: z.array(z.string()),
  columnTypes: z.array(z.string()),
  sampleRows: z.array(z.array(z.string())),
})

/**
 * Schema for chart info.
 */
export const excelChartInfoSchema = z.object({
  sheetName: z.string(),
  type: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string(),
})

/**
 * Schema for Excel metadata.
 */
export const excelMetadataSchema = z.object({
  format: excelFormatSchema,
  sizeTier: sizeTierSchema,
  injectionStrategy: injectionStrategySchema,
  totalSheets: z.number(),
  totalRows: z.number(),
  totalCells: z.number(),
  author: z.string().nullable(),
  createdAt: z.string().nullable(),
  modifiedAt: z.string().nullable(),
  sheets: z.array(excelSheetInfoSchema),
  charts: z.array(excelChartInfoSchema),
})

/**
 * Schema for workbook summary output.
 */
export const excelSummarySchema = z.object({
  summary: z.string().describe("2-3 sentence summary of the workbook content"),
  keyTopics: z.array(z.string()).describe("Main topics or data categories covered"),
})

export type ExcelSummaryOutput = z.infer<typeof excelSummarySchema>

// ============================================================================
// Prompts
// ============================================================================

export const EXCEL_SUMMARY_SYSTEM_PROMPT = `You are a data analysis specialist. Analyze the provided Excel workbook content and create a structured summary.

Guidelines:
- Write a 2-3 sentence summary capturing the main purpose and content of the workbook
- List key topics or data categories covered
- Be factual and concise
- Focus on information that would help someone understand what the workbook contains without opening it`

export const EXCEL_SUMMARY_USER_PROMPT = `Summarize this Excel workbook. The file is named "{filename}" and contains {sheetCount} sheet(s) with approximately {totalRows} total rows and {totalCells} total cells.

Sheet overview:
{sheetOverview}

Sample data:
{sampleData}`
