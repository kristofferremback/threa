import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { getCachedWsConfig, setCachedWsConfig } from "./cached-ws-config"

describe("cached-ws-config", () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it("round-trips per-workspace socket config", () => {
    setCachedWsConfig("ws_1", { region: "us-east", wsUrl: "wss://edge.example/ws" })
    expect(getCachedWsConfig("ws_1")).toEqual({ region: "us-east", wsUrl: "wss://edge.example/ws" })
  })

  it("scopes config by workspace id", () => {
    setCachedWsConfig("ws_1", { region: "us-east", wsUrl: "wss://a" })
    setCachedWsConfig("ws_2", { region: "eu-west", wsUrl: "wss://b" })
    expect(getCachedWsConfig("ws_1")).toEqual({ region: "us-east", wsUrl: "wss://a" })
    expect(getCachedWsConfig("ws_2")).toEqual({ region: "eu-west", wsUrl: "wss://b" })
  })

  it("returns null for an uncached workspace", () => {
    expect(getCachedWsConfig("ws_unknown")).toBeNull()
  })

  it("rejects a malformed payload instead of returning a partial config", () => {
    localStorage.setItem("threa-ws-config:ws_1", JSON.stringify({ region: "us-east" }))
    expect(getCachedWsConfig("ws_1")).toBeNull()
  })

  it("returns null on unparseable JSON rather than throwing", () => {
    localStorage.setItem("threa-ws-config:ws_1", "{not json")
    expect(getCachedWsConfig("ws_1")).toBeNull()
  })
})
