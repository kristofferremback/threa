import { DynamicStructuredTool } from "@langchain/core/tools"
import { z } from "zod"
import { logger } from "../../../lib/logger"
import { EXCEL_MAX_ROWS_PER_REQUEST } from "../../attachments"

const LoadExcelSectionSchema = z
  .object({
    attachmentId: z.string().describe("The ID of the Excel attachment"),
    sheetName: z.string().describe("The name of the sheet to load data from"),
    startRow: z.number().int().min(0).optional().describe("Start row (0-indexed, inclusive). Defaults to 0."),
    endRow: z.number().int().min(0).optional().describe("End row (0-indexed, exclusive). Defaults to end of sheet."),
  })
  .refine(
    (data) => {
      if (data.startRow !== undefined && data.endRow !== undefined) {
        return data.startRow < data.endRow
      }
      return true
    },
    {
      message: "startRow must be less than endRow",
      path: ["startRow"],
    }
  )
  .refine(
    (data) => {
      if (data.startRow !== undefined && data.endRow !== undefined) {
        return data.endRow - data.startRow <= EXCEL_MAX_ROWS_PER_REQUEST
      }
      return true
    },
    {
      message: `Cannot load more than ${EXCEL_MAX_ROWS_PER_REQUEST} rows at once`,
      path: ["endRow"],
    }
  )

export type LoadExcelSectionInput = z.infer<typeof LoadExcelSectionSchema>

/**
 * Result from loading an Excel section.
 * Contains the table data for the requested sheet and row range.
 */
export interface LoadExcelSectionResult {
  attachmentId: string
  filename: string
  sheetName: string
  startRow: number
  endRow: number
  totalRows: number
  headers: string[]
  /** Content as a markdown table */
  content: string
}

export interface LoadExcelSectionCallbacks {
  loadExcelSection: (input: LoadExcelSectionInput) => Promise<LoadExcelSectionResult | null>
}

/**
 * Creates a load_excel_section tool for loading specific row ranges from large Excel workbooks.
 *
 * This tool is only useful for large workbooks (>20K cells) where full content isn't
 * injected into context. For small/medium workbooks, full content is already available.
 *
 * Use the sheets metadata from the attachment extraction to identify relevant
 * sheets and row ranges before calling this tool.
 */
export function createLoadExcelSectionTool(callbacks: LoadExcelSectionCallbacks) {
  return new DynamicStructuredTool({
    name: "load_excel_section",
    description: `Load specific rows from a sheet in a large Excel workbook. Only use this when:
- The workbook is large (>20K cells) and injection strategy is "summary" (full content not in context)
- You need to read specific rows from a particular sheet
- The user asks about data in a specific sheet or row range

The attachment extraction includes excelMetadata.sheets with sheet names, row counts, headers, and sample rows. Use that to determine which sheet and rows to load.

For small/medium workbooks (<20K cells), full content is already available in fullText - don't use this tool.`,
    schema: LoadExcelSectionSchema,
    func: async (input: LoadExcelSectionInput) => {
      try {
        const result = await callbacks.loadExcelSection(input)

        if (!result) {
          return JSON.stringify({
            error: "Excel file not found, not accessible, or sheet/rows not available",
            attachmentId: input.attachmentId,
            sheetName: input.sheetName,
          })
        }

        logger.debug(
          {
            attachmentId: input.attachmentId,
            sheetName: input.sheetName,
            startRow: result.startRow,
            endRow: result.endRow,
            contentLength: result.content.length,
          },
          "Excel section loaded"
        )

        return JSON.stringify({
          filename: result.filename,
          sheetName: result.sheetName,
          rowRange: `${result.startRow}-${result.endRow - 1} of ${result.totalRows}`,
          headers: result.headers,
          content: result.content,
        })
      } catch (error) {
        logger.error({ error, ...input }, "Load Excel section failed")
        return JSON.stringify({
          error: `Failed to load Excel section: ${error instanceof Error ? error.message : "Unknown error"}`,
          attachmentId: input.attachmentId,
        })
      }
    },
  })
}
