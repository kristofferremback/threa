import { describe, test, expect } from "bun:test"
import * as XLSX from "xlsx"
import { extractExcel } from "./extractor"

/**
 * Helper to create an xlsx buffer from sheet data.
 */
function createXlsxBuffer(sheets: Record<string, unknown[][]>): Buffer {
  const workbook = XLSX.utils.book_new()
  for (const [name, data] of Object.entries(sheets)) {
    const worksheet = XLSX.utils.aoa_to_sheet(data)
    XLSX.utils.book_append_sheet(workbook, worksheet, name)
  }
  const arrayBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })
  return Buffer.from(arrayBuffer)
}

describe("extractExcel", () => {
  test("should treat all rows as data with column-letter headers", () => {
    const buffer = createXlsxBuffer({
      Sheet1: [
        ["Name", "Age", "City"],
        ["Alice", 30, "NYC"],
        ["Bob", 25, "LA"],
        ["Carol", 35, "Chicago"],
      ],
    })

    const result = extractExcel(buffer, "xlsx")

    expect(result.sheets).toHaveLength(1)
    const sheet = result.sheets[0]
    expect(sheet.name).toBe("Sheet1")
    expect(sheet.headers).toEqual(["A", "B", "C"])
    expect(sheet.rows).toBe(4)
    expect(sheet.columns).toBe(3)
    expect(sheet.data).toHaveLength(4)
    expect(sheet.data[0]).toEqual(["Name", "Age", "City"])
    expect(sheet.data[1]).toEqual(["Alice", "30", "NYC"])
    expect(sheet.sampleRows).toHaveLength(4)
  })

  test("should extract multiple sheets", () => {
    const buffer = createXlsxBuffer({
      Sales: [
        ["Product", "Revenue"],
        ["Widget A", 1000],
        ["Widget B", 2000],
      ],
      Costs: [
        ["Item", "Cost"],
        ["Materials", 500],
      ],
    })

    const result = extractExcel(buffer, "xlsx")

    expect(result.sheets).toHaveLength(2)
    expect(result.sheets[0].name).toBe("Sales")
    expect(result.sheets[0].rows).toBe(3)
    expect(result.sheets[1].name).toBe("Costs")
    expect(result.sheets[1].rows).toBe(2)
  })

  test("should handle empty sheets", () => {
    const buffer = createXlsxBuffer({
      Empty: [],
    })

    const result = extractExcel(buffer, "xlsx")

    expect(result.sheets).toHaveLength(1)
    expect(result.sheets[0].name).toBe("Empty")
    expect(result.sheets[0].rows).toBe(0)
    expect(result.sheets[0].columns).toBe(0)
    expect(result.sheets[0].headers).toEqual([])
    expect(result.sheets[0].data).toEqual([])
  })

  test("should handle wide sheets (many columns)", () => {
    const headers = Array.from({ length: 20 }, (_, i) => `Col${i + 1}`)
    const row = Array.from({ length: 20 }, (_, i) => `Val${i + 1}`)

    const buffer = createXlsxBuffer({
      Wide: [headers, row],
    })

    const result = extractExcel(buffer, "xlsx")

    expect(result.sheets[0].columns).toBe(20)
    expect(result.sheets[0].headers).toHaveLength(20)
  })

  test("should read column types from cell metadata", () => {
    const buffer = createXlsxBuffer({
      Types: [
        [1, "Alice", 95.5, true, new Date("2024-01-15")],
        [2, "Bob", 87.3, false, new Date("2024-02-20")],
        [3, "Carol", 92.1, true, new Date("2024-03-10")],
      ],
    })

    const result = extractExcel(buffer, "xlsx")
    const types = result.sheets[0].columnTypes

    expect(types[0]).toBe("integer")
    expect(types[1]).toBe("text")
    expect(types[2]).toBe("number")
    expect(types[3]).toBe("boolean")
    expect(types[4]).toBe("date")
  })

  test("should use autofilter headers when defined", () => {
    const workbook = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Age", "City"],
      ["Alice", 30, "NYC"],
      ["Bob", 25, "LA"],
    ])
    ws["!autofilter"] = { ref: "A1:C3" }
    XLSX.utils.book_append_sheet(workbook, ws, "Sheet1")
    const buffer = Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }))

    const result = extractExcel(buffer, "xlsx")
    const sheet = result.sheets[0]

    expect(sheet.headers).toEqual(["Name", "Age", "City"])
    expect(sheet.rows).toBe(2)
    expect(sheet.data[0]).toEqual(["Alice", "30", "NYC"])
  })

  test("should limit sample rows to configured amount", () => {
    const data: unknown[][] = []
    for (let i = 0; i < 100; i++) {
      data.push([`Row ${i}`])
    }

    const buffer = createXlsxBuffer({ Big: data })
    const result = extractExcel(buffer, "xlsx")

    expect(result.sheets[0].rows).toBe(100)
    // Sample rows should be limited (EXCEL_SAMPLE_ROWS = 5)
    expect(result.sheets[0].sampleRows.length).toBeLessThanOrEqual(5)
  })

  test("should return metadata with author info when available", () => {
    const workbook = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([["A"]])
    XLSX.utils.book_append_sheet(workbook, ws, "Sheet1")
    workbook.Props = {
      Author: "Test Author",
      CreatedDate: new Date("2024-01-01"),
      ModifiedDate: new Date("2024-06-15"),
    }

    const arrayBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })
    const buffer = Buffer.from(arrayBuffer)

    const result = extractExcel(buffer, "xlsx")

    expect(result.metadata.author).toBe("Test Author")
    // Note: SheetJS may or may not preserve dates in round-trip depending on version
    // So we just check the structure exists
    expect(result.metadata).toHaveProperty("createdAt")
    expect(result.metadata).toHaveProperty("modifiedAt")
  })
})
