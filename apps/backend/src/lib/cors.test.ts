import { describe, expect, test } from "bun:test"
import { createCorsOriginChecker } from "./cors"

describe("createCorsOriginChecker", () => {
  test("allows configured origins", () => {
    const checker = createCorsOriginChecker(["https://app.example.com"])

    let allowed: boolean | undefined
    checker("https://app.example.com", (err, result) => {
      expect(err).toBeNull()
      allowed = result as boolean
    })

    expect(allowed).toBe(true)
  })

  test("allows requests without Origin header", () => {
    const checker = createCorsOriginChecker(["https://app.example.com"])

    let allowed: boolean | undefined
    checker(undefined, (err, result) => {
      expect(err).toBeNull()
      allowed = result as boolean
    })

    expect(allowed).toBe(true)
  })

  test("rejects non-allowlisted origins", () => {
    const checker = createCorsOriginChecker(["https://app.example.com"])

    let errorMessage = ""
    checker("https://evil.example.com", (err) => {
      errorMessage = err instanceof Error ? err.message : ""
    })

    expect(errorMessage).toBe("CORS origin not allowed")
  })
})
