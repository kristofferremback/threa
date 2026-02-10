const DEBUG_STORAGE_KEY = "threa:debug:bootstrap"

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
  if (details === undefined) {
    console.log(`[BootstrapDebug ${timestamp}] ${message}`)
    return
  }

  console.log(`[BootstrapDebug ${timestamp}] ${message}`, details)
}

if (typeof window !== "undefined") {
  ;(
    window as Window & {
      __threaBootstrapDebug?: { enable: () => void; disable: () => void; enabled: () => boolean }
    }
  ).__threaBootstrapDebug = {
    enable: () => setBootstrapDebugEnabled(true),
    disable: () => setBootstrapDebugEnabled(false),
    enabled: () => isBootstrapDebugEnabled(),
  }
}
