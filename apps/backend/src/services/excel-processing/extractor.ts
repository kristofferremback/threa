/**
 * Excel Content Extraction
 *
 * Uses SheetJS to extract structured content from Excel workbooks.
 * Returns computed values (not formulas), infers column types, and
 * extracts chart metadata where available.
 */

import * as XLSX from "xlsx"
import type { ExcelFormat } from "./detector"
import { EXCEL_SAMPLE_ROWS } from "./config"

export interface ExtractedSheet {
  name: string
  rows: number
  columns: number
  headers: string[]
  columnTypes: string[]
  /** All rows as strings (computed values) */
  data: string[][]
  /** First N rows for display */
  sampleRows: string[][]
}

export interface WorkbookMetadata {
  author: string | null
  createdAt: Date | null
  modifiedAt: Date | null
}

export interface ExtractedChart {
  sheetName: string
  type: string | null
  title: string | null
  description: string
}

export interface ExcelExtractionResult {
  sheets: ExtractedSheet[]
  metadata: WorkbookMetadata
  charts: ExtractedChart[]
}

/**
 * Extract content from an Excel workbook buffer.
 *
 * @param buffer - File buffer
 * @param _format - Detected format (xlsx or xls)
 * @returns Structured extraction result
 */
export function extractExcel(buffer: Buffer, _format: ExcelFormat): ExcelExtractionResult {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    cellNF: true,
  })

  const sheets: ExtractedSheet[] = []

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName]
    if (!worksheet) continue

    // Convert sheet to array of arrays (computed values as strings)
    const rawData: unknown[][] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false,
      defval: "",
    })

    if (rawData.length === 0) {
      sheets.push({
        name: sheetName,
        rows: 0,
        columns: 0,
        headers: [],
        columnTypes: [],
        data: [],
        sampleRows: [],
      })
      continue
    }

    // First row is headers
    const headers = rawData[0].map((cell) => String(cell ?? ""))
    const dataRows = rawData.slice(1).map((row) => row.map((cell) => String(cell ?? "")))

    // Infer column types by scanning first ~20 data rows
    const columnTypes = inferColumnTypes(dataRows.slice(0, 20), headers.length)

    // Build sample rows
    const sampleRows = dataRows.slice(0, EXCEL_SAMPLE_ROWS)

    sheets.push({
      name: sheetName,
      rows: dataRows.length,
      columns: headers.length,
      headers,
      columnTypes,
      data: dataRows,
      sampleRows,
    })
  }

  // Extract workbook metadata
  const props = workbook.Props ?? {}
  const metadata: WorkbookMetadata = {
    author: props.Author ?? null,
    createdAt: props.CreatedDate instanceof Date ? props.CreatedDate : null,
    modifiedAt: props.ModifiedDate instanceof Date ? props.ModifiedDate : null,
  }

  // Extract chart metadata from SheetJS
  const charts = extractChartMetadata(workbook)

  return { sheets, metadata, charts }
}

/**
 * Infer column types by examining the first N data rows.
 * Returns an array of type strings (one per column).
 */
function inferColumnTypes(rows: string[][], columnCount: number): string[] {
  const types: string[] = new Array(columnCount).fill("text")

  for (let col = 0; col < columnCount; col++) {
    const values = rows.map((row) => row[col] ?? "").filter((v) => v !== "")

    if (values.length === 0) {
      types[col] = "empty"
      continue
    }

    const allNumbers = values.every((v) => !isNaN(Number(v)) && v.trim() !== "")
    if (allNumbers) {
      // Check if integers or decimals
      const allIntegers = values.every((v) => Number.isInteger(Number(v)))
      types[col] = allIntegers ? "integer" : "number"
      continue
    }

    // Check for dates (common patterns)
    const datePattern = /^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/
    const allDates = values.every((v) => datePattern.test(v))
    if (allDates) {
      types[col] = "date"
      continue
    }

    // Check for booleans
    const boolValues = new Set(["true", "false", "yes", "no", "1", "0"])
    const allBools = values.every((v) => boolValues.has(v.toLowerCase()))
    if (allBools) {
      types[col] = "boolean"
      continue
    }

    types[col] = "text"
  }

  return types
}

/**
 * Extract chart metadata from workbook.
 * SheetJS has limited chart support, so we extract what's available.
 */
function extractChartMetadata(workbook: XLSX.WorkBook): ExtractedChart[] {
  const charts: ExtractedChart[] = []

  // SheetJS exposes chart sheets as separate entries
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    // Check if this is a chart sheet (SheetJS marks these with !type)
    if ((sheet as Record<string, unknown>)["!type"] === "chart") {
      charts.push({
        sheetName,
        type: null,
        title: sheetName,
        description: `Chart sheet "${sheetName}"`,
      })
    }
  }

  return charts
}
