import { describe, expect, it } from "bun:test"
import { createUploadMiddleware, MAX_FILE_SIZE } from "./upload"

describe("upload middleware", () => {
  it("creates an express middleware handler", () => {
    const handler = createUploadMiddleware({
      s3Config: {
        bucket: "test-bucket",
        region: "us-east-1",
        accessKeyId: "test",
        secretAccessKey: "test",
      },
    })

    expect(typeof handler).toBe("function")
  })

  it("enforces the 100MB max file size", () => {
    expect(MAX_FILE_SIZE).toBe(100 * 1024 * 1024)
  })
})
