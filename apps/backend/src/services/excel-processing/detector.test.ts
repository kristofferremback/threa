import { describe, test, expect } from "bun:test"
import { detectExcelFormat, validateExcelFormat } from "./detector"

describe("detectExcelFormat", () => {
  test("should detect xlsx from PK magic bytes", () => {
    const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])
    expect(detectExcelFormat(buffer)).toBe("xlsx")
  })

  test("should detect xls from OLE magic bytes", () => {
    const buffer = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1])
    expect(detectExcelFormat(buffer)).toBe("xls")
  })

  test("should return null for unknown format", () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]) // PNG header
    expect(detectExcelFormat(buffer)).toBeNull()
  })

  test("should return null for buffer shorter than 4 bytes", () => {
    const buffer = Buffer.from([0x50, 0x4b])
    expect(detectExcelFormat(buffer)).toBeNull()
  })

  test("should return null for empty buffer", () => {
    const buffer = Buffer.alloc(0)
    expect(detectExcelFormat(buffer)).toBeNull()
  })
})

describe("validateExcelFormat", () => {
  test("should return format for valid xlsx buffer", () => {
    const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])
    expect(validateExcelFormat(buffer)).toBe("xlsx")
  })

  test("should return format for valid xls buffer", () => {
    const buffer = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1])
    expect(validateExcelFormat(buffer)).toBe("xls")
  })

  test("should throw for invalid format", () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    expect(() => validateExcelFormat(buffer)).toThrow("Invalid Excel document: unrecognized file format")
  })
})
