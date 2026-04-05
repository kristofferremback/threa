import { describe, it, expect } from "vitest"
import { resolveDmDisplayName } from "./streams"

describe("resolveDmDisplayName", () => {
  const workspaceUsers = [
    { id: "user_viewer", name: "Viewer" },
    { id: "user_pierre", name: "Pierre Boberg" },
  ]

  it("returns the peer user's name when the DM peer is known", () => {
    const dmPeers = [{ streamId: "stream_dm_1", userId: "user_pierre" }]
    expect(resolveDmDisplayName("stream_dm_1", workspaceUsers, dmPeers)).toBe("Pierre Boberg")
  })

  it("returns null when no DM peer entry exists for the stream", () => {
    expect(resolveDmDisplayName("stream_dm_unknown", workspaceUsers, [])).toBeNull()
  })

  it("returns null when the peer user is not present in the workspace users cache", () => {
    const dmPeers = [{ streamId: "stream_dm_1", userId: "user_missing" }]
    expect(resolveDmDisplayName("stream_dm_1", workspaceUsers, dmPeers)).toBeNull()
  })

  it("prefers the peer lookup over whatever string was cached on the stream row", () => {
    // Regression: when a stream:created socket event writes displayName: null
    // or "Direct message" into IDB, the sidebar should still render the
    // peer's real name by falling back to workspaceUsers via dmPeers.
    const dmPeers = [{ streamId: "stream_dm_1", userId: "user_pierre" }]
    const resolved = resolveDmDisplayName("stream_dm_1", workspaceUsers, dmPeers)
    expect(resolved).toBe("Pierre Boberg")
  })
})
