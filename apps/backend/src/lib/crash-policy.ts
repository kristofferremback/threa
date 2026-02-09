type GlobalCrashSource = "uncaughtException" | "unhandledRejection"

type CrashClassification = "non_fatal_db_session_timeout" | "fatal_process_error"

export interface CrashPolicyDecision {
  isFatal: boolean
  classification: CrashClassification
  logMessage: string
}

const POSTGRES_IDLE_SESSION_TIMEOUT_CODE = "57P05"
const IDLE_SESSION_TIMEOUT_PATTERN = /idle[-_\s]?session[-_\s]?timeout/i

const NON_FATAL_DB_TIMEOUT_LOG_MESSAGES: Record<GlobalCrashSource, string> = {
  uncaughtException:
    "Non-fatal database/session timeout in uncaught exception - connection was closed by PostgreSQL as expected",
  unhandledRejection:
    "Non-fatal database/session timeout in unhandled rejection - connection was closed by PostgreSQL as expected",
}

const FATAL_LOG_MESSAGES: Record<GlobalCrashSource, string> = {
  uncaughtException: "Uncaught exception",
  unhandledRejection: "Unhandled rejection",
}

export function classifyGlobalCrash(source: GlobalCrashSource, reason: unknown): CrashPolicyDecision {
  if (isNonFatalDatabaseSessionTimeout(reason)) {
    return {
      isFatal: false,
      classification: "non_fatal_db_session_timeout",
      logMessage: NON_FATAL_DB_TIMEOUT_LOG_MESSAGES[source],
    }
  }

  return {
    isFatal: true,
    classification: "fatal_process_error",
    logMessage: FATAL_LOG_MESSAGES[source],
  }
}

export function serializeCrashReason(reason: unknown): Record<string, unknown> {
  if (reason instanceof Error) {
    const reasonInfo: Record<string, unknown> = {
      message: reason.message,
      stack: reason.stack,
      name: reason.name,
    }
    const errorCode = getErrorCode(reason)
    if (errorCode) {
      reasonInfo.code = errorCode
    }
    return reasonInfo
  }

  if (typeof reason === "object" && reason !== null) {
    try {
      return { ...reason, stringified: JSON.stringify(reason) }
    } catch {
      return { value: String(reason) }
    }
  }

  return { value: String(reason) }
}

export function isNonFatalDatabaseSessionTimeout(reason: unknown): boolean {
  const errorCode = getErrorCode(reason)
  if (errorCode === POSTGRES_IDLE_SESSION_TIMEOUT_CODE) {
    return true
  }

  const message = getMessage(reason)
  if (!message) {
    return false
  }

  return IDLE_SESSION_TIMEOUT_PATTERN.test(message)
}

function getErrorCode(reason: unknown): string | null {
  if (typeof reason !== "object" || reason === null) {
    return null
  }

  const maybeCode = (reason as { code?: unknown }).code
  if (typeof maybeCode !== "string") {
    return null
  }

  return maybeCode
}

function getMessage(reason: unknown): string | null {
  if (reason instanceof Error) {
    return reason.message
  }

  if (typeof reason !== "object" || reason === null) {
    return null
  }

  const maybeMessage = (reason as { message?: unknown }).message
  if (typeof maybeMessage !== "string") {
    return null
  }

  return maybeMessage
}
