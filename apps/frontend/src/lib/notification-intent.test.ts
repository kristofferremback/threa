import { describe, it, expect } from "vitest"
import { setNotificationIntent, takeNotificationIntent } from "./notification-intent"

describe("notification-intent", () => {
  it("take returns the stashed id once, then null (one-shot)", () => {
    setNotificationIntent("ws_1", "user_recipient")

    expect(takeNotificationIntent("ws_1")).toBe("user_recipient")
    // Consumed — a second take for the same workspace yields nothing
    expect(takeNotificationIntent("ws_1")).toBeNull()
  })

  it("take returns null when the workspace does not match the stashed intent", () => {
    setNotificationIntent("ws_a", "user_recipient")

    // Mismatched workspace must not consume the pending intent
    expect(takeNotificationIntent("ws_b")).toBeNull()
    // The original workspace can still claim it
    expect(takeNotificationIntent("ws_a")).toBe("user_recipient")
  })

  it("a newer intent overwrites an unconsumed one", () => {
    setNotificationIntent("ws_1", "user_first")
    setNotificationIntent("ws_2", "user_second")

    expect(takeNotificationIntent("ws_1")).toBeNull()
    expect(takeNotificationIntent("ws_2")).toBe("user_second")
  })

  it("take returns null when nothing was stashed", () => {
    expect(takeNotificationIntent("ws_none")).toBeNull()
  })
})
