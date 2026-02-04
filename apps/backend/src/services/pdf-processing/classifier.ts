/**
 * PDF Page Classifier
 *
 * Classifies PDF pages based on their content characteristics
 * to determine the optimal extraction strategy.
 */

import type { PdfPageClassification } from "@threa/types"
import { PdfPageClassifications } from "@threa/types"
import { PDF_TEXT_THRESHOLDS } from "./config"

export interface ClassificationInput {
  /** Raw text extracted from the page */
  rawText: string | null
  /** Number of embedded images in the page */
  imageCount: number
  /** Whether tables were detected */
  hasTables: boolean
  /** Whether multi-column layout was detected */
  isMultiColumn: boolean
}

export interface ClassificationResult {
  classification: PdfPageClassification
  confidence: number
}

/**
 * Classify a PDF page based on its content characteristics.
 *
 * Classification determines processing strategy:
 * - text_rich: Use raw text extraction (fastest)
 * - scanned: Apply OCR via Tesseract
 * - complex_layout: Use Gemini for intelligent extraction
 * - mixed: Combine text extraction + image captioning
 * - empty: Skip processing
 */
export function classifyPage(input: ClassificationInput): ClassificationResult {
  const { rawText, imageCount, hasTables, isMultiColumn } = input
  const textLength = rawText?.length ?? 0

  // Empty pages
  if (textLength < 10 && imageCount === 0) {
    return { classification: PdfPageClassifications.EMPTY, confidence: 0.95 }
  }

  // Scanned document (image-only or minimal text)
  if (textLength < PDF_TEXT_THRESHOLDS.scanned && imageCount > 0) {
    return { classification: PdfPageClassifications.SCANNED, confidence: 0.85 }
  }

  // Complex layout (tables, multi-column, or significant images with text)
  if (hasTables || isMultiColumn) {
    return { classification: PdfPageClassifications.COMPLEX_LAYOUT, confidence: 0.8 }
  }

  // Mixed content (text + embedded images)
  if (textLength >= PDF_TEXT_THRESHOLDS.textRich && imageCount > 0) {
    return { classification: PdfPageClassifications.MIXED, confidence: 0.75 }
  }

  // Text-rich (straightforward text extraction)
  if (textLength >= PDF_TEXT_THRESHOLDS.textRich) {
    return { classification: PdfPageClassifications.TEXT_RICH, confidence: 0.9 }
  }

  // Default to scanned if we have images but little text
  if (imageCount > 0) {
    return { classification: PdfPageClassifications.SCANNED, confidence: 0.6 }
  }

  // Fallback to empty if very little content
  return { classification: PdfPageClassifications.EMPTY, confidence: 0.5 }
}

/**
 * Batch classify multiple pages.
 */
export function classifyPages(inputs: ClassificationInput[]): ClassificationResult[] {
  return inputs.map(classifyPage)
}
