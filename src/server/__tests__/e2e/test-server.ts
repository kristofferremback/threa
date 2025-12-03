import express from "express"
import cookieParser from "cookie-parser"
import http from "http"
import type { Server as HTTPServer } from "http"
import { Pool } from "pg"
import { io as ioClient, Socket as ClientSocket } from "socket.io-client"
import { promisify } from "util"

import { StubAuthService } from "../../services/stub-auth-service"
import { createAuthMiddleware, createAuthHandlers } from "../../routes/auth-routes"
import { createStreamHandlers } from "../../routes/stream-routes"
import { createSearchHandlers } from "../../routes/search-routes"
import { createInvitationHandlers } from "../../routes/invitation-routes"
import { createMemoHandlers } from "../../routes/memo-routes"
import { StreamService } from "../../services/stream-service"
import { WorkspaceService } from "../../services/workspace-service"
import { UserService } from "../../services/user-service"
import { SearchService } from "../../services/search-service"
import { setupStreamWebSocket } from "../../websockets/stream-socket"
import { runMigrations } from "../../lib/migrations"
import { OutboxListener } from "../../lib/outbox-listener"
import { createSocketIORedisClients, type RedisClient } from "../../lib/redis"
import {
  getTestPool,
  closeTestPool,
  cleanupTestData,
  createTestUser,
  createTestWorkspace,
  addUserToWorkspace,
  TEST_DATABASE_URL,
  type TestUser,
  type TestWorkspace,
} from "../../services/__tests__/test-helpers"
import { checkOllamaHealth } from "../../lib/ollama"

/**
 * E2E Test Server
 *
 * NOTE: When running multiple e2e test files, use --max-concurrency=1 to prevent
 * port conflicts: `bun test src/server/__tests__/e2e --max-concurrency=1`
 */
const TEST_PORT = 3099

export interface TestServerContext {
  // Server components
  app: express.Application
  server: HTTPServer
  pool: Pool
  baseUrl: string

  // Services
  authService: StubAuthService
  streamService: StreamService
  workspaceService: WorkspaceService
  userService: UserService

  // Redis clients
  redisPubClient: RedisClient
  redisSubClient: RedisClient
  outboxListener: OutboxListener

  // Socket.IO server cleanup
  closeSocketIO: () => Promise<void>

  // Helpers
  /**
   * Create a test user and register them with the stub auth service.
   * Returns the user and their session token.
   */
  createAuthenticatedUser(overrides?: Partial<TestUser>): Promise<{
    user: TestUser
    sessionToken: string
  }>

  /**
   * Create a WebSocket client for a user.
   * Automatically connects with the user's session.
   */
  createSocketClient(sessionToken: string): Promise<ClientSocket>

  /**
   * Make an authenticated HTTP request.
   */
  fetch(path: string, options?: RequestInit & { sessionToken?: string }): Promise<Response>

  /**
   * Clean up test data between tests
   */
  cleanup(): Promise<void>

  /**
   * Close everything
   */
  close(): Promise<void>
}

let serverInstance: TestServerContext | null = null

/**
 * Get or create a shared test server instance.
 * The server is reused across tests for performance.
 */
export async function getTestServer(): Promise<TestServerContext> {
  if (serverInstance) {
    return serverInstance
  }

  const pool = await getTestPool()
  await runMigrations(pool)

  // Check Ollama availability for embeddings (needed for search tests)
  await checkOllamaHealth()

  const app = express()
  app.use(express.json())
  app.use(cookieParser())

  // Health check
  app.get("/health", (_, res) => res.json({ status: "ok" }))

  // Create services
  const authService = new StubAuthService()
  const streamService = new StreamService(pool)
  const workspaceService = new WorkspaceService(pool)
  const userService = new UserService(pool)
  const searchService = new SearchService(pool)
  const outboxListener = new OutboxListener(pool, TEST_DATABASE_URL)

  // Create Redis clients
  const { pubClient: redisPubClient, subClient: redisSubClient } = await createSocketIORedisClients()

  // Create middleware and handlers
  const authMiddleware = createAuthMiddleware(authService as any)
  const auth = createAuthHandlers({ authService: authService as any })
  const streams = createStreamHandlers({ streamService, workspaceService, pool })
  const search = createSearchHandlers({ searchService })
  const invitations = createInvitationHandlers({ workspaceService })
  const memos = createMemoHandlers({ pool })

  // Auth routes
  app.get("/api/auth/login", auth.login)
  app.all("/api/auth/callback", auth.callback)
  app.get("/api/auth/logout", auth.logout)
  app.get("/api/auth/me", authMiddleware, auth.me)

  // Invitation routes (public)
  app.get("/api/invite/:token", invitations.getInvitation)
  app.post("/api/invite/:token/accept", authMiddleware, invitations.acceptInvitation)

  // Workspace routes
  app.post("/api/workspace", authMiddleware, streams.createWorkspace)
  app.get("/api/workspace/default/bootstrap", authMiddleware, streams.getDefaultBootstrap)
  app.get("/api/workspace/:workspaceId/bootstrap", authMiddleware, streams.getBootstrap)

  // Stream routes
  app.get("/api/workspace/:workspaceId/streams/check-slug", authMiddleware, streams.checkSlug)
  app.get("/api/workspace/:workspaceId/streams/browse", authMiddleware, streams.browseStreams)
  app.get("/api/workspace/:workspaceId/streams/by-event/:eventId/thread", authMiddleware, streams.getThreadByEvent)
  app.get("/api/workspace/:workspaceId/streams/:streamId", authMiddleware, streams.getStream)
  app.get("/api/workspace/:workspaceId/streams/:streamId/ancestors", authMiddleware, streams.getAncestors)
  app.post("/api/workspace/:workspaceId/streams", authMiddleware, streams.createStream)
  app.post("/api/workspace/:workspaceId/thinking-spaces", authMiddleware, streams.createThinkingSpace)
  app.patch("/api/workspace/:workspaceId/streams/:streamId", authMiddleware, streams.updateStream)
  app.delete("/api/workspace/:workspaceId/streams/:streamId", authMiddleware, streams.archiveStream)

  // Stream membership
  app.post("/api/workspace/:workspaceId/streams/:streamId/join", authMiddleware, streams.joinStream)
  app.post("/api/workspace/:workspaceId/streams/:streamId/leave", authMiddleware, streams.leaveStream)
  app.post("/api/workspace/:workspaceId/streams/:streamId/pin", authMiddleware, streams.pinStream)
  app.post("/api/workspace/:workspaceId/streams/:streamId/unpin", authMiddleware, streams.unpinStream)
  app.get("/api/workspace/:workspaceId/streams/:streamId/members", authMiddleware, streams.getMembers)
  app.post("/api/workspace/:workspaceId/streams/:streamId/members", authMiddleware, streams.addMember)
  app.delete("/api/workspace/:workspaceId/streams/:streamId/members/:memberId", authMiddleware, streams.removeMember)

  // Stream read state
  app.post("/api/workspace/:workspaceId/streams/:streamId/read", authMiddleware, streams.markAsRead)
  app.post("/api/workspace/:workspaceId/streams/:streamId/unread", authMiddleware, streams.markAsUnread)

  // Thread operations
  app.post("/api/workspace/:workspaceId/streams/:streamId/thread", authMiddleware, streams.createThread)
  app.get("/api/workspace/:workspaceId/streams/:streamId/events/:eventId/thread", authMiddleware, streams.getThreadForEvent)
  app.post("/api/workspace/:workspaceId/streams/:streamId/promote", authMiddleware, streams.promoteStream)
  app.post("/api/workspace/:workspaceId/streams/:streamId/share", authMiddleware, streams.shareEvent)

  // Event routes
  app.get("/api/workspace/:workspaceId/streams/:streamId/events", authMiddleware, streams.getEvents)
  app.post("/api/workspace/:workspaceId/streams/:streamId/events", authMiddleware, streams.createEvent)
  app.patch("/api/workspace/:workspaceId/streams/:streamId/events/:eventId", authMiddleware, streams.editEvent)
  app.delete("/api/workspace/:workspaceId/streams/:streamId/events/:eventId", authMiddleware, streams.deleteEvent)
  app.get("/api/workspace/:workspaceId/streams/:streamId/events/:eventId/revisions", authMiddleware, streams.getEventRevisions)
  app.post("/api/workspace/:workspaceId/streams/:streamId/events/:eventId/reply", authMiddleware, streams.replyToEvent)
  app.get("/api/workspace/:workspaceId/events/:eventId", authMiddleware, streams.getEventDetails)

  // Search routes
  app.post("/api/workspace/:workspaceId/search", authMiddleware, search.search)
  app.get("/api/workspace/:workspaceId/search", authMiddleware, search.searchGet)
  app.get("/api/workspace/:workspaceId/search/suggestions", authMiddleware, search.getSuggestions)

  // Notification routes
  app.get("/api/workspace/:workspaceId/notifications/count", authMiddleware, streams.getNotificationCount)
  app.get("/api/workspace/:workspaceId/notifications", authMiddleware, streams.getNotifications)
  app.post("/api/workspace/:workspaceId/notifications/:notificationId/read", authMiddleware, streams.markNotificationAsRead)
  app.post("/api/workspace/:workspaceId/notifications/read-all", authMiddleware, streams.markAllNotificationsAsRead)

  // Profile routes
  app.get("/api/workspace/:workspaceId/profile", authMiddleware, streams.getProfile)
  app.patch("/api/workspace/:workspaceId/profile", authMiddleware, streams.updateProfile)

  // Workspace invitation routes
  app.post("/api/workspace/:workspaceId/invitations", authMiddleware, streams.createInvitation)
  app.get("/api/workspace/:workspaceId/invitations", authMiddleware, streams.getInvitations)
  app.delete("/api/workspace/:workspaceId/invitations/:invitationId", authMiddleware, streams.revokeInvitation)

  // Memo routes
  app.get("/api/workspace/:workspaceId/memos", authMiddleware, memos.listMemos)
  app.get("/api/workspace/:workspaceId/memos/:memoId", authMiddleware, memos.getMemo)
  app.post("/api/workspace/:workspaceId/memos", authMiddleware, memos.createMemo)
  app.patch("/api/workspace/:workspaceId/memos/:memoId", authMiddleware, memos.updateMemo)
  app.delete("/api/workspace/:workspaceId/memos/:memoId", authMiddleware, memos.archiveMemo)
  app.get("/api/workspace/:workspaceId/experts", authMiddleware, memos.getExperts)

  // Create HTTP server
  const server = http.createServer(app)

  // Set up WebSocket with stub auth
  const socketServer = await setupStreamWebSocket(server, pool, streamService, authService as any)

  // Start listening
  await promisify(server.listen).bind(server)(TEST_PORT)

  // Start outbox listener for real-time events
  await outboxListener.start()

  const baseUrl = `http://localhost:${TEST_PORT}`

  // Track connected clients for cleanup
  const connectedClients: ClientSocket[] = []

  serverInstance = {
    app,
    server,
    pool,
    baseUrl,
    authService,
    streamService,
    workspaceService,
    userService,
    redisPubClient,
    redisSubClient,
    outboxListener,
    closeSocketIO: async () => {
      await socketServer.closeWithCleanup()
    },

    async createAuthenticatedUser(overrides = {}) {
      const user = await createTestUser(pool, overrides)
      const sessionToken = authService.registerTestUser({
        id: user.id,
        email: user.email,
        firstName: user.name.split(" ")[0] || null,
        lastName: user.name.split(" ").slice(1).join(" ") || null,
      })
      return { user, sessionToken }
    },

    async createSocketClient(sessionToken: string) {
      return new Promise<ClientSocket>((resolve, reject) => {
        const client = ioClient(baseUrl, {
          transports: ["websocket"],
          extraHeaders: {
            Cookie: `wos_session=${sessionToken}`,
          },
        })

        const timeout = setTimeout(() => {
          client.disconnect()
          reject(new Error("Socket connection timeout"))
        }, 5000)

        client.on("connect", () => {
          clearTimeout(timeout)
          connectedClients.push(client)
          resolve(client)
        })

        client.on("connect_error", (err) => {
          clearTimeout(timeout)
          reject(err)
        })
      })
    },

    async fetch(path, options = {}) {
      const { sessionToken, ...fetchOptions } = options
      const headers = new Headers(fetchOptions.headers)

      if (sessionToken) {
        headers.set("Cookie", `wos_session=${sessionToken}`)
      }

      return fetch(`${baseUrl}${path}`, {
        ...fetchOptions,
        headers,
      })
    },

    async cleanup() {
      // Disconnect all socket clients
      for (const client of connectedClients) {
        client.disconnect()
      }
      connectedClients.length = 0

      // Clear auth users
      authService.clearUsers()

      // Clean database
      await cleanupTestData(pool)
    },

    async close() {
      // Disconnect all socket clients
      for (const client of connectedClients) {
        client.disconnect()
      }
      connectedClients.length = 0

      // Stop outbox listener
      await outboxListener.stop()

      // Close Socket.IO
      await socketServer.closeWithCleanup()

      // Close server
      if (server.listening) {
        await promisify(server.close.bind(server))()
      }

      // Close Redis
      await redisPubClient.quit()
      await redisSubClient.quit()

      // Close pool
      await closeTestPool()

      serverInstance = null
    },
  }

  return serverInstance
}

/**
 * Helper to wait for a socket event with timeout
 */
export function waitForSocketEvent<T = unknown>(
  socket: ClientSocket,
  event: string,
  timeoutMs: number = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for socket event: ${event}`))
    }, timeoutMs)

    socket.once(event, (data: T) => {
      clearTimeout(timeout)
      resolve(data)
    })
  })
}

/**
 * Helper to collect multiple socket events
 */
export function collectSocketEvents<T = unknown>(
  socket: ClientSocket,
  event: string,
  count: number,
  timeoutMs: number = 5000,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const events: T[] = []
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${count} "${event}" events, got ${events.length}`))
    }, timeoutMs)

    const handler = (data: T) => {
      events.push(data)
      if (events.length >= count) {
        clearTimeout(timeout)
        socket.off(event, handler)
        resolve(events)
      }
    }

    socket.on(event, handler)
  })
}
