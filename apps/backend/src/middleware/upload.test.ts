import { describe, expect, it } from "bun:test"
import { createAttachmentMimeTypeFileFilter } from "./upload"

describe("createAttachmentMimeTypeFileFilter", () => {
  it("accepts files when MIME type is allowlisted", () => {
    const filter = createAttachmentMimeTypeFileFilter(["image/png", "application/pdf"])

    let accepted: boolean | undefined
    let error: Error | null | undefined

    filter(
      {} as any,
      {
        mimetype: "image/png",
      } as Express.Multer.File,
      (err: Error | null, allow?: boolean) => {
        error = err
        accepted = allow
      }
    )

    expect(error).toBeNull()
    expect(accepted).toBe(true)
  })

  it("rejects files when MIME type is not allowlisted", () => {
    const filter = createAttachmentMimeTypeFileFilter(["image/png"])

    let error: Error | null | undefined

    filter(
      {} as any,
      {
        mimetype: "application/x-msdownload",
      } as Express.Multer.File,
      (err: Error | null) => {
        error = err
      }
    )

    expect(error).toBeInstanceOf(Error)
    expect(error?.message).toBe("File type not allowed: application/x-msdownload")
  })
})
