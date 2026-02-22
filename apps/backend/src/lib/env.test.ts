import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { loadConfig } from "./env"
import { logger } from "./logger"

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

describe("loadConfig attachment safety policy", () => {
  test("enables malware scan by default", () => {
    setBaseEnv()
    process.env.NODE_ENV = "development"
    process.env.USE_STUB_AUTH = "true"

    const config = loadConfig()
    expect(config.attachments.malwareScanEnabled).toBe(true)
  })

  test("allows disabling malware scan via env", () => {
    setBaseEnv()
    process.env.NODE_ENV = "development"
    process.env.USE_STUB_AUTH = "true"
    process.env.ATTACHMENT_MALWARE_SCAN_ENABLED = "false"

    const config = loadConfig()
    expect(config.attachments.malwareScanEnabled).toBe(false)
  })
})

describe("loadConfig workspace creation invite policy", () => {
  test("defaults workspace creation invite requirement to enabled", () => {
    setBaseEnv()
    process.env.NODE_ENV = "development"
    process.env.USE_STUB_AUTH = "true"

    const config = loadConfig()
    expect(config.workspaceCreationRequiresInvite).toBe(true)
  })

  test("allows disabling workspace creation invite requirement when configured", () => {
    setBaseEnv()
    process.env.NODE_ENV = "development"
    process.env.USE_STUB_AUTH = "true"
    process.env.WORKSPACE_CREATION_SKIP_INVITE = "true"

    const config = loadConfig()
    expect(config.workspaceCreationRequiresInvite).toBe(false)
  })

  test("logs warning when stub auth is used with invite requirement enabled", () => {
    setBaseEnv()
    process.env.NODE_ENV = "development"
    process.env.USE_STUB_AUTH = "true"

    const warnSpy = spyOn(logger, "warn")

    loadConfig()

    expect(warnSpy).toHaveBeenCalledWith(
      "USE_STUB_AUTH is enabled while workspace creation invite checks are enabled; stub auth cannot verify WorkOS invites and will allow workspace creation. Set WORKSPACE_CREATION_SKIP_INVITE=true to make the bypass explicit."
    )
    warnSpy.mockRestore()
  })
})
