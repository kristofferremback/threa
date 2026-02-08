import { afterEach, describe, expect, test } from "bun:test"
import { loadConfig } from "./env"

const ORIGINAL_ENV = { ...process.env }

function resetEnv() {
  process.env = { ...ORIGINAL_ENV }
}

function setBaseEnv() {
  process.env.DATABASE_URL = "postgres://localhost:5432/threa_test"
}

afterEach(() => {
  resetEnv()
})

describe("loadConfig stub auth safety", () => {
  test("throws when stub auth is enabled in production", () => {
    setBaseEnv()
    process.env.NODE_ENV = "production"
    process.env.USE_STUB_AUTH = "true"
    process.env.CORS_ALLOWED_ORIGINS = "https://app.example.com"

    expect(() => loadConfig()).toThrow("USE_STUB_AUTH must be false in production")
  })

  test("allows stub auth outside production", () => {
    setBaseEnv()
    process.env.NODE_ENV = "development"
    process.env.USE_STUB_AUTH = "true"

    const config = loadConfig()
    expect(config.useStubAuth).toBe(true)
  })

  test("requires explicit CORS allowlist in production", () => {
    setBaseEnv()
    process.env.NODE_ENV = "production"
    process.env.USE_STUB_AUTH = "false"
    process.env.WORKOS_API_KEY = "key"
    process.env.WORKOS_CLIENT_ID = "client"
    process.env.WORKOS_REDIRECT_URI = "https://app.example.com/callback"
    process.env.WORKOS_COOKIE_PASSWORD = "password"

    expect(() => loadConfig()).toThrow("CORS_ALLOWED_ORIGINS is required in production")
  })
})
