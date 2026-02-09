import { beforeAll, afterAll, describe, expect, test } from "bun:test"
import { io, Socket } from "socket.io-client"
import {
  TestClient,
  createScratchpad,
  createWorkspace,
  joinRoom,
  joinWorkspace,
  loginAs,
  sendMessage,
} from "../../client"

function getBaseUrl(): string {
  return process.env.TEST_BASE_URL || "http://localhost:3001"
}

function encodeState(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64")
}

function toStubWorkosUserId(email: string): string {
  return `workos_test_${email.replace(/[^a-z0-9]/gi, "_")}`
}

function buildCookieHeader(client: TestClient): string {
  return (client as any).cookies
    ? Array.from((client as any).cookies.entries())
        .map(([k, v]: [string, string]) => `${k}=${v}`)
        .join("; ")
    : ""
}

function createSocket(client: TestClient): Socket {
  return io(getBaseUrl(), {
    extraHeaders: {
      Cookie: buildCookieHeader(client),
    },
    transports: ["websocket"],
    autoConnect: false,
  })
}

function waitForEvent<T = unknown>(socket: Socket, eventName: string, timeoutMs: number = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName, handler)
      reject(new Error(`Timeout waiting for event: ${eventName}`))
    }, timeoutMs)

    const handler = (data: T) => {
      clearTimeout(timeout)
      socket.off(eventName, handler)
      resolve(data)
    }

    socket.on(eventName, handler)
  })
}

function trackEventCount(socket: Socket, eventName: string): { getCount: () => number; stop: () => void } {
  let count = 0
  const handler = () => {
    count += 1
  }

  socket.on(eventName, handler)

  return {
    getCount: () => count,
    stop: () => socket.off(eventName, handler),
  }
}

async function connectSocket(socket: Socket, timeoutMs: number = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Socket connection timeout"))
    }, timeoutMs)

    socket.on("connect", () => {
      clearTimeout(timeout)
      resolve()
    })

    socket.on("connect_error", (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    socket.connect()
  })
}

describe("P0 Security Regression Coverage", () => {
  const runId = Math.random().toString(36).slice(2)

  describe("Auth Redirect Sanitization", () => {
    test("auth callback falls back to / for external redirect target", async () => {
      const client = new TestClient()
      const email = `redirect-callback-${runId}@example.com`
      await loginAs(client, email, "Redirect Callback User")

      const code = `test_code_${toStubWorkosUserId(email)}`
      const state = encodeState("https://evil.example/phish")

      const response = await fetch(
        `${getBaseUrl()}/api/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
        {
          method: "GET",
          headers: {
            Cookie: buildCookieHeader(client),
          },
          redirect: "manual",
        }
      )

      expect(response.status).toBe(302)
      expect(response.headers.get("location")).toBe("/")
    })

    test("auth callback preserves internal relative redirect target", async () => {
      const client = new TestClient()
      const email = `redirect-safe-${runId}@example.com`
      await loginAs(client, email, "Redirect Safe User")

      const code = `test_code_${toStubWorkosUserId(email)}`
      const safePath = "/workspaces/ws_123?tab=streams#latest"
      const state = encodeState(safePath)

      const response = await fetch(
        `${getBaseUrl()}/api/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
        {
          method: "GET",
          headers: {
            Cookie: buildCookieHeader(client),
          },
          redirect: "manual",
        }
      )

      expect(response.status).toBe(302)
      expect(response.headers.get("location")).toBe(safePath)
    })

    test("stub auth login falls back to / for external redirect target", async () => {
      const response = await fetch(`${getBaseUrl()}/test-auth-login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: `redirect-stub-${runId}@example.com`,
          name: "Redirect Stub User",
          state: encodeState("https://evil.example/stub-phish"),
        }),
        redirect: "manual",
      })

      expect(response.status).toBe(302)
      expect(response.headers.get("location")).toBe("/")
    })
  })

  describe("Authorization Enforcement", () => {
    test("ai-budget update endpoint rejects member role and allows admin", async () => {
      const ownerClient = new TestClient()
      const memberClient = new TestClient()
      const adminClient = new TestClient()

      await loginAs(ownerClient, `budget-owner-${runId}@example.com`, "Budget Owner")
      const workspace = await createWorkspace(ownerClient, `Budget Workspace ${runId}`)

      await loginAs(memberClient, `budget-member-${runId}@example.com`, "Budget Member")
      await joinWorkspace(memberClient, workspace.id, "member")

      await loginAs(adminClient, `budget-admin-${runId}@example.com`, "Budget Admin")
      await joinWorkspace(adminClient, workspace.id, "admin")

      const memberResult = await memberClient.put(`/api/workspaces/${workspace.id}/ai-budget`, {
        monthlyBudgetUsd: 100,
      })
      expect(memberResult.status).toBe(403)

      const adminResult = await adminClient.put(`/api/workspaces/${workspace.id}/ai-budget`, {
        monthlyBudgetUsd: 250,
      })
      expect(adminResult.status).toBe(200)
      expect((adminResult.data as { budget?: { monthlyBudgetUsd?: number } }).budget?.monthlyBudgetUsd).toBe(250)
    })
  })

  describe("Realtime Privacy Boundary", () => {
    let ownerClient: TestClient
    let outsiderClient: TestClient
    let ownerSocket: Socket
    let outsiderSocket: Socket

    beforeAll(async () => {
      ownerClient = new TestClient()
      outsiderClient = new TestClient()

      await loginAs(ownerClient, `privacy-owner-${runId}@example.com`, "Privacy Owner")
      await loginAs(outsiderClient, `privacy-outsider-${runId}@example.com`, "Privacy Outsider")
    })

    afterAll(() => {
      if (ownerSocket) {
        ownerSocket.disconnect()
      }
      if (outsiderSocket) {
        outsiderSocket.disconnect()
      }
    })

    test("does not deliver stream:activity preview content to workspace members outside the stream", async () => {
      const workspace = await createWorkspace(ownerClient, `Privacy Workspace ${runId}`)
      const privateStream = await createScratchpad(ownerClient, workspace.id, "off")

      await joinWorkspace(outsiderClient, workspace.id, "member")

      ownerSocket = createSocket(ownerClient)
      await connectSocket(ownerSocket)
      await joinRoom(ownerSocket, `ws:${workspace.id}:stream:${privateStream.id}`)

      outsiderSocket = createSocket(outsiderClient)
      await connectSocket(outsiderSocket)
      await joinRoom(outsiderSocket, `ws:${workspace.id}`)

      const outsiderActivity = trackEventCount(outsiderSocket, "stream:activity")
      const secret = `TOP SECRET ${runId}`
      const ownerActivityPromise = waitForEvent(ownerSocket, "stream:activity")

      await sendMessage(ownerClient, workspace.id, privateStream.id, secret)
      await ownerActivityPromise

      // The event has been emitted for the stream room; outsider in workspace room must not receive it.
      expect(outsiderActivity.getCount()).toBe(0)
      outsiderActivity.stop()
    })
  })
})
