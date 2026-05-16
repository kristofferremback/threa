import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, spyOnExport } from "@/test"
import { AuthProvider, useAuth } from "@/auth"
import * as dbModule from "@/db"

let triggerLogout: () => void

function LogoutProbe() {
  triggerLogout = useAuth().logout
  return null
}

describe("AuthProvider logout", () => {
  const originalLocation = window.location
  const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker")

  beforeEach(() => {
    vi.useFakeTimers()

    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { href: "" } as Location,
    })

    // The mount effect calls /api/auth/me; keep it from throwing.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 401, ok: false, json: async () => ({}) }) as unknown as Response)
    )

    spyOnExport(dbModule, "clearAllCachedData").mockReturnValue((async () => {}) as typeof dbModule.clearAllCachedData)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation })
    if (originalServiceWorker) {
      Object.defineProperty(navigator, "serviceWorker", originalServiceWorker)
    } else {
      // @ts-expect-error — jsdom has no serviceWorker by default; remove our stub
      delete navigator.serviceWorker
    }
  })

  it("redirects to the logout endpoint even when navigator.serviceWorker.ready never resolves", async () => {
    // Reproduces the desktop dev failure: an injectManifest module SW stranded
    // in "installing" means navigator.serviceWorker.ready never settles. The
    // push-cleanup step must not be able to block the logout redirect.
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ready: new Promise<never>(() => {}) },
    })

    render(
      <AuthProvider>
        <LogoutProbe />
      </AuthProvider>
    )

    await act(async () => {
      triggerLogout()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(window.location.href).toBe("/api/auth/logout")
  })
})
