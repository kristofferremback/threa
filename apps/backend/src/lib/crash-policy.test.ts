import { describe, expect, test } from "bun:test"
import type { CrashPolicyDecision } from "./crash-policy"
import { classifyGlobalCrash, isNonFatalDatabaseSessionTimeout, serializeCrashReason } from "./crash-policy"

describe("crash policy", () => {
  test("should classify PostgreSQL idle-session timeout code as non-fatal", () => {
    const reason = Object.assign(new Error("terminating connection due to idle-session-timeout"), { code: "57P05" })
    const want: CrashPolicyDecision = {
      isFatal: false,
      classification: "non_fatal_db_session_timeout",
      logMessage:
        "Non-fatal database/session timeout in uncaught exception - connection was closed by PostgreSQL as expected",
    }

    expect(classifyGlobalCrash("uncaughtException", reason)).toEqual(want)
  })

  test("should classify idle-session timeout message without code as non-fatal", () => {
    const reason = new Error("PostgreSQL terminating connection due to idle_session_timeout")
    const want: CrashPolicyDecision = {
      isFatal: false,
      classification: "non_fatal_db_session_timeout",
      logMessage:
        "Non-fatal database/session timeout in unhandled rejection - connection was closed by PostgreSQL as expected",
    }

    expect(classifyGlobalCrash("unhandledRejection", reason)).toEqual(want)
  })

  test("should classify unknown errors as fatal", () => {
    const reason = new Error("boom")
    const want: CrashPolicyDecision = {
      isFatal: true,
      classification: "fatal_process_error",
      logMessage: "Uncaught exception",
    }

    expect(classifyGlobalCrash("uncaughtException", reason)).toEqual(want)
  })

  test("should return true for non-fatal timeout classification helper", () => {
    const reason = { message: "terminating connection due to idle session timeout" }
    expect(isNonFatalDatabaseSessionTimeout(reason)).toEqual(true)
  })

  test("should serialize rejection reasons with fallback for circular objects", () => {
    const reason = { value: "x" } as { value: string; self?: unknown }
    reason.self = reason
    const want = { value: "[object Object]" }

    expect(serializeCrashReason(reason)).toEqual(want)
  })
})
