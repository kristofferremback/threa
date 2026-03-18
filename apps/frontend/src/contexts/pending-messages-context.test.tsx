import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import type { ReactNode } from "react"
import { PendingMessagesProvider, usePendingMessages } from "./pending-messages-context"

const mockGet = vi.fn()
const mockUpdate = vi.fn().mockResolvedValue(1)
const mockEventsUpdate = vi.fn().mockResolvedValue(1)

vi.mock("@/db", () => ({
  db: {
    pendingMessages: {
      get: (...args: unknown[]) => mockGet(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
    events: {
      update: (...args: unknown[]) => mockEventsUpdate(...args),
    },
  },
}))

function wrapper({ children }: { children: ReactNode }) {
  return <PendingMessagesProvider>{children}</PendingMessagesProvider>
}

describe("PendingMessagesContext", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("retryMessage", () => {
    it("should bail out when the message no longer exists in IndexedDB", async () => {
      mockGet.mockResolvedValue(undefined)

      const { result } = renderHook(() => usePendingMessages(), { wrapper })

      // Mark message as failed first so we can verify it stays failed
      act(() => result.current.markFailed("temp_gone"))

      await act(async () => {
        await result.current.retryMessage("temp_gone")
      })

      expect(mockGet).toHaveBeenCalledWith("temp_gone")
      // Should NOT have attempted any DB update or UI state change
      expect(mockUpdate).not.toHaveBeenCalled()
      expect(mockEventsUpdate).not.toHaveBeenCalled()
      // Status should remain "failed", not flip to "pending"
      expect(result.current.getStatus("temp_gone")).toBe("failed")
    })

    it("should reset retryCount and re-enqueue when the message exists", async () => {
      mockGet.mockResolvedValue({ clientId: "temp_retry", retryCount: 2 })

      const { result } = renderHook(() => usePendingMessages(), { wrapper })

      act(() => result.current.markFailed("temp_retry"))

      await act(async () => {
        await result.current.retryMessage("temp_retry")
      })

      expect(mockUpdate).toHaveBeenCalledWith("temp_retry", { retryCount: 0 })
      expect(mockEventsUpdate).toHaveBeenCalledWith("temp_retry", { _status: "pending" })
      expect(result.current.getStatus("temp_retry")).toBe("pending")
    })
  })
})
