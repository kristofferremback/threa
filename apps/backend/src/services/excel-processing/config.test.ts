import { describe, test, expect } from "bun:test"
import { isExcelAttachment } from "./config"

describe("isExcelAttachment", () => {
  test("should return true for xlsx MIME type", () => {
    expect(isExcelAttachment("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "data.xlsx")).toBe(
      true
    )
  })

  test("should return true for xls MIME type", () => {
    expect(isExcelAttachment("application/vnd.ms-excel", "data.xls")).toBe(true)
  })

  test("should return true for xlsm MIME type", () => {
    expect(isExcelAttachment("application/vnd.ms-excel.sheet.macroEnabled.12", "data.xlsm")).toBe(true)
  })

  test("should return true for .xlsx with octet-stream", () => {
    expect(isExcelAttachment("application/octet-stream", "report.xlsx")).toBe(true)
  })

  test("should return true for .xls with octet-stream", () => {
    expect(isExcelAttachment("application/octet-stream", "report.xls")).toBe(true)
  })

  test("should return true for .xlsm with octet-stream", () => {
    expect(isExcelAttachment("application/octet-stream", "report.xlsm")).toBe(true)
  })

  test("should return true for .XLSX with octet-stream (case insensitive)", () => {
    expect(isExcelAttachment("application/octet-stream", "REPORT.XLSX")).toBe(true)
  })

  test("should return false for Word MIME type", () => {
    expect(
      isExcelAttachment("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "doc.docx")
    ).toBe(false)
  })

  test("should return false for PDF MIME type", () => {
    expect(isExcelAttachment("application/pdf", "file.pdf")).toBe(false)
  })

  test("should return false for text MIME type", () => {
    expect(isExcelAttachment("text/plain", "file.txt")).toBe(false)
  })

  test("should return false for octet-stream with non-Excel extension", () => {
    expect(isExcelAttachment("application/octet-stream", "file.doc")).toBe(false)
  })
})
