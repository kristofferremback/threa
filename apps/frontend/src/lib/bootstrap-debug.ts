const DEBUG_STORAGE_KEY = "threa:debug:bootstrap"
const DEBUG_BUFFER_LIMIT = 500

function getFlagFromSearchParams(): boolean | null {
  if (typeof window === "undefined") {
    return null
  }

  const value = new URLSearchParams(window.location.search).get("debugBootstrap")
  if (value === "1" || value === "true") return true
  if (value === "0" || value === "false") return false
  return null
}

export function isBootstrapDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false
  }

  const paramFlag = getFlagFromSearchParams()
  if (paramFlag !== null) {
    return paramFlag
  }

  const stored = window.localStorage.getItem(DEBUG_STORAGE_KEY)
  return stored === "1" || stored === "true"
}

export function setBootstrapDebugEnabled(enabled: boolean): void {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(DEBUG_STORAGE_KEY, enabled ? "1" : "0")
}

export function debugBootstrap(message: string, details?: unknown): void {
  if (!isBootstrapDebugEnabled()) {
    return
  }

  const timestamp = new Date().toISOString()
  const entry = { timestamp, message, details }

  if (typeof window !== "undefined") {
    const runtimeWindow = window as Window & { __threaBootstrapDebugLogs?: unknown[] }
    const logs = runtimeWindow.__threaBootstrapDebugLogs ?? []
    logs.push(entry)
    if (logs.length > DEBUG_BUFFER_LIMIT) {
      logs.splice(0, logs.length - DEBUG_BUFFER_LIMIT)
    }
    runtimeWindow.__threaBootstrapDebugLogs = logs
  }

  if (details === undefined) {
    console.log(`[BootstrapDebug ${timestamp}] ${message}`)
    return
  }

  console.log(`[BootstrapDebug ${timestamp}] ${message}`, details)
}

if (typeof window !== "undefined") {
  ;(
    window as Window & {
      __threaBootstrapDebug?: {
        enable: () => void
        disable: () => void
        enabled: () => boolean
        dump: () => unknown[]
        clear: () => void
      }
      __threaBootstrapDebugLogs?: unknown[]
    }
  ).__threaBootstrapDebug = {
    enable: () => setBootstrapDebugEnabled(true),
    disable: () => setBootstrapDebugEnabled(false),
    enabled: () => isBootstrapDebugEnabled(),
    dump: () => (window as Window & { __threaBootstrapDebugLogs?: unknown[] }).__threaBootstrapDebugLogs ?? [],
    clear: () => {
      ;(window as Window & { __threaBootstrapDebugLogs?: unknown[] }).__threaBootstrapDebugLogs = []
    },
  }
}
