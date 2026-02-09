/**
 * PDF Processing Configuration
 *
 * Central configuration for PDF extraction and analysis.
 * Used by PDFProcessingService and future evals.
 */

import { z } from "zod"
import { PDF_PAGE_CLASSIFICATIONS, PDF_SIZE_TIERS } from "@threa/types"

// ============================================================================
// Model Configuration
// ============================================================================

/**
 * Model for complex layout analysis (tables, multi-column, etc.)
 * Gemini 2.5 Flash handles document understanding well.
 */
export const PDF_LAYOUT_MODEL_ID = "openrouter:google/gemini-2.5-flash"

/**
 * Model for document summarization.
 */
export const PDF_SUMMARY_MODEL_ID = "openrouter:google/gemini-2.5-flash"

/**
 * Temperature settings for PDF processing.
 */
export const PDF_TEMPERATURES = {
  layout: 0.1, // Low for consistent extraction
  summary: 0.3, // Slightly higher for creative summarization
} as const

// ============================================================================
// Size Thresholds
// ============================================================================

/**
 * Page count thresholds for determining size tier.
 * Affects context injection strategy.
 */
export const PDF_SIZE_THRESHOLDS = {
  /** Small PDFs (<8 pages): full content injected */
  small: 8,
  /** Medium PDFs (8-25 pages): full content + size note */
  medium: 25,
  /** Large PDFs (>25 pages): summary + sections + load_pdf_section tool */
} as const

/**
 * Text extraction thresholds for page classification.
 */
export const PDF_TEXT_THRESHOLDS = {
  /** Minimum chars for text_rich classification */
  textRich: 100,
  /** Maximum chars for scanned classification */
  scanned: 50,
} as const

// ============================================================================
// Supported PDF Types
// ============================================================================

/**
 * MIME types that indicate a PDF file.
 */
export const PDF_MIME_TYPES = ["application/pdf"] as const

/**
 * File extensions that indicate a PDF file.
 * Used when mime_type is application/octet-stream.
 */
export const PDF_EXTENSIONS = [".pdf"] as const

/**
 * Check if an attachment is a PDF based on mime type and filename.
 */
export function isPdfAttachment(mimeType: string, filename: string): boolean {
  if (PDF_MIME_TYPES.includes(mimeType as (typeof PDF_MIME_TYPES)[number])) {
    return true
  }

  if (mimeType === "application/octet-stream") {
    const lowerFilename = filename.toLowerCase()
    return PDF_EXTENSIONS.some((ext) => lowerFilename.endsWith(ext))
  }

  return false
}

// ============================================================================
// Schemas
// ============================================================================

/**
 * Schema for page classification output.
 */
export const pageClassificationSchema = z.object({
  classification: z.enum(PDF_PAGE_CLASSIFICATIONS).describe("Page content classification"),
  confidence: z.number().min(0).max(1).describe("Classification confidence 0-1"),
  hasEmbeddedImages: z.boolean().describe("Whether page contains embedded images"),
  layoutComplexity: z.enum(["simple", "moderate", "complex"]).describe("Layout complexity level"),
})

export type PageClassificationOutput = z.infer<typeof pageClassificationSchema>

/**
 * Schema for complex layout extraction output.
 */
export const layoutExtractionSchema = z.object({
  markdown: z.string().describe("Page content as markdown"),
  tables: z
    .array(
      z.object({
        headers: z.array(z.string()),
        rows: z.array(z.array(z.string())),
        caption: z.string().nullable(),
      })
    )
    .nullable()
    .describe("Extracted tables if any"),
  figures: z
    .array(
      z.object({
        description: z.string(),
        caption: z.string().nullable(),
      })
    )
    .nullable()
    .describe("Descriptions of figures/images"),
})

export type LayoutExtractionOutput = z.infer<typeof layoutExtractionSchema>

/**
 * Schema for document summary output.
 */
export const documentSummarySchema = z.object({
  title: z.string().nullable().describe("Document title if identifiable"),
  summary: z.string().describe("2-3 sentence summary of the entire document"),
  keyTopics: z.array(z.string()).describe("Main topics covered"),
  sections: z
    .array(
      z.object({
        startPage: z.number().describe("Section start page (1-indexed)"),
        endPage: z.number().describe("Section end page (1-indexed)"),
        title: z.string().describe("Section title or description"),
      })
    )
    .describe("Document sections with page ranges"),
})

export type DocumentSummaryOutput = z.infer<typeof documentSummarySchema>

/**
 * Schema for size tier output.
 */
export const sizeTierSchema = z.enum(PDF_SIZE_TIERS)

// ============================================================================
// Prompts
// ============================================================================

export const PDF_LAYOUT_SYSTEM_PROMPT = `You are a document extraction specialist. Your task is to convert PDF page images into clean, structured markdown.

Guidelines:
- Preserve document structure (headings, lists, tables)
- Convert tables to markdown table format
- Describe images and figures briefly
- Maintain reading order for multi-column layouts
- Extract all visible text accurately
- Handle forms by preserving field labels and values

Output clean markdown that captures all content from the page.`

export const PDF_LAYOUT_USER_PROMPT = `Convert this PDF page image to markdown. Preserve all text, structure, tables, and describe any figures.`

export const PDF_SUMMARY_SYSTEM_PROMPT = `You are a document summarization specialist. Analyze the provided document content and create a structured summary.

Guidelines:
- Identify the document title if present
- Write a 2-3 sentence summary capturing the main purpose
- List key topics covered
- Identify logical sections with page ranges
- Be factual and concise`

export const PDF_SUMMARY_USER_PROMPT = `Summarize this document and identify its sections. The document has {totalPages} pages.

Document content:
{content}`
