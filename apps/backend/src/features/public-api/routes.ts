/**
 * Public API route registry — the single source of truth for OpenAPI spec generation.
 *
 * Every public API endpoint MUST be registered here. The generator script reads this
 * registry at build time and produces the OpenAPI 3.0 spec. Adding a route to routes.ts
 * but not here is a build error (caught by the pre-commit drift check).
 */
import { z } from "zod"
import { API_KEY_SCOPES, STREAM_TYPES, AUTHOR_TYPES } from "@threa/types"
import type { ApiKeyScope } from "@threa/types"
import {
  publicSearchSchema,
  listStreamsSchema,
  listMessagesSchema,
  sendMessageSchema,
  updateMessageSchema,
  listMembersSchema,
  listUsersSchema,
} from "./schemas"

// ---------------------------------------------------------------------------
// Response schemas — the single source of truth for public API wire shapes.
// Serializer return types are derived from these schemas (see WireStream etc.)
// so any drift between docs and runtime is a compile-time error.
// ---------------------------------------------------------------------------

const streamSchema = z.object({
  id: z.string(),
  type: z.enum(STREAM_TYPES),
  displayName: z.string(),
  slug: z.string().optional(),
  description: z.string().optional(),
  visibility: z.string(),
  parentStreamId: z.string().optional(),
  rootStreamId: z.string().optional(),
  parentMessageId: z.string().optional(),
  createdAt: z.string().datetime(),
  archivedAt: z.string().datetime().optional(),
})

const messageSchema = z.object({
  id: z.string(),
  streamId: z.string(),
  sequence: z.string().describe("Numeric sequence as string"),
  authorId: z.string(),
  authorType: z.enum(AUTHOR_TYPES),
  authorDisplayName: z.string().optional(),
  content: z.string(),
  replyCount: z.number().int(),
  threadStreamId: z.string().optional(),
  clientMessageId: z.string().optional(),
  editedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
})

const searchResultSchema = z.object({
  id: z.string(),
  streamId: z.string(),
  sequence: z.string().describe("Numeric sequence as string"),
  content: z.string(),
  authorId: z.string(),
  authorType: z.enum(AUTHOR_TYPES),
  authorDisplayName: z.string().optional(),
  replyCount: z.number().int(),
  editedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  rank: z.number(),
})

const memberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  slug: z.string(),
  avatarUrl: z.string().optional(),
  joinedAt: z.string().datetime(),
})

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  email: z.string(),
  avatarUrl: z.string().optional(),
  role: z.string(),
})

const errorSchema = z.object({
  error: z.string(),
  details: z.record(z.string(), z.array(z.string())).optional(),
})

// Paginated wrappers
function paginated(itemSchema: z.ZodType) {
  return z.object({
    data: z.array(itemSchema),
    hasMore: z.boolean(),
    cursor: z.string().nullable(),
  })
}

function dataEnvelope(itemSchema: z.ZodType) {
  return z.object({ data: itemSchema })
}

function dataArrayEnvelope(itemSchema: z.ZodType) {
  return z.object({ data: z.array(itemSchema) })
}

// ---------------------------------------------------------------------------
// Common path parameters
// ---------------------------------------------------------------------------
const workspaceIdParam = {
  name: "workspaceId",
  in: "path" as const,
  required: true,
  schema: { type: "string" as const },
  description: "Workspace ID (prefixed ULID)",
}

const streamIdParam = {
  name: "streamId",
  in: "path" as const,
  required: true,
  schema: { type: "string" as const },
  description: "Stream ID (prefixed ULID)",
}

const messageIdParam = {
  name: "messageId",
  in: "path" as const,
  required: true,
  schema: { type: "string" as const },
  description: "Message ID (prefixed ULID)",
}

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------

export interface PublicApiRoute {
  method: "get" | "post" | "patch" | "delete"
  path: string
  operationId: string
  summary: string
  description?: string
  tags: string[]
  scopes: ApiKeyScope[]
  parameters?: Array<{
    name: string
    in: "path" | "query"
    required: boolean
    schema: { type: string }
    description: string
  }>
  /** Zod schema for query parameters (GET) or request body (POST/PATCH) */
  requestSchema?: z.ZodType
  /** Where the request schema applies */
  requestIn?: "query" | "body"
  /** Zod schema for successful response body */
  responseSchema: z.ZodType
  /** HTTP status code for successful response */
  successStatus?: number
  /** Whether the endpoint can return 404 (resource not found) */
  canReturn404?: boolean
}

export const PUBLIC_API_ROUTES: PublicApiRoute[] = [
  // --- Search ---
  {
    method: "post",
    path: "/api/v1/workspaces/{workspaceId}/messages/search",
    operationId: "searchMessages",
    summary: "Search messages",
    description: "Full-text and optional semantic search across accessible streams.",
    tags: ["Messages"],
    scopes: [API_KEY_SCOPES.MESSAGES_SEARCH],
    parameters: [workspaceIdParam],
    requestSchema: publicSearchSchema,
    requestIn: "body",
    responseSchema: dataArrayEnvelope(searchResultSchema),
  },

  // --- Streams ---
  {
    method: "get",
    path: "/api/v1/workspaces/{workspaceId}/streams",
    operationId: "listStreams",
    summary: "List streams",
    description: "List streams accessible to this API key, with optional type and text filters.",
    tags: ["Streams"],
    scopes: [API_KEY_SCOPES.STREAMS_READ],
    parameters: [workspaceIdParam],
    requestSchema: listStreamsSchema,
    requestIn: "query",
    responseSchema: paginated(streamSchema),
  },
  {
    method: "get",
    path: "/api/v1/workspaces/{workspaceId}/streams/{streamId}",
    operationId: "getStream",
    summary: "Get a stream",
    tags: ["Streams"],
    scopes: [API_KEY_SCOPES.STREAMS_READ],
    parameters: [workspaceIdParam, streamIdParam],
    responseSchema: dataEnvelope(streamSchema),
    canReturn404: true,
  },
  {
    method: "get",
    path: "/api/v1/workspaces/{workspaceId}/streams/{streamId}/members",
    operationId: "listMembers",
    summary: "List stream members",
    tags: ["Streams"],
    scopes: [API_KEY_SCOPES.STREAMS_READ],
    parameters: [workspaceIdParam, streamIdParam],
    requestSchema: listMembersSchema,
    requestIn: "query",
    responseSchema: paginated(memberSchema),
  },

  // --- Messages ---
  {
    method: "get",
    path: "/api/v1/workspaces/{workspaceId}/streams/{streamId}/messages",
    operationId: "listMessages",
    summary: "List messages in a stream",
    description: "Cursor-paginated message list. Use `before` or `after` sequence numbers.",
    tags: ["Messages"],
    scopes: [API_KEY_SCOPES.MESSAGES_READ],
    parameters: [workspaceIdParam, streamIdParam],
    requestSchema: listMessagesSchema,
    requestIn: "query",
    responseSchema: z.object({
      data: z.array(messageSchema),
      hasMore: z.boolean(),
    }),
  },
  {
    method: "post",
    path: "/api/v1/workspaces/{workspaceId}/streams/{streamId}/messages",
    operationId: "sendMessage",
    summary: "Send a message",
    description:
      "Send a message as a bot. The bot identity is derived from the API key name. Messages are sent as Markdown.",
    tags: ["Messages"],
    scopes: [API_KEY_SCOPES.MESSAGES_WRITE],
    parameters: [workspaceIdParam, streamIdParam],
    requestSchema: sendMessageSchema,
    requestIn: "body",
    responseSchema: dataEnvelope(messageSchema),
    successStatus: 201,
  },
  {
    method: "patch",
    path: "/api/v1/workspaces/{workspaceId}/messages/{messageId}",
    operationId: "updateMessage",
    summary: "Update a message",
    description: "Update a message previously sent by this API key's bot.",
    tags: ["Messages"],
    scopes: [API_KEY_SCOPES.MESSAGES_WRITE],
    parameters: [workspaceIdParam, messageIdParam],
    requestSchema: updateMessageSchema,
    requestIn: "body",
    responseSchema: dataEnvelope(messageSchema),
    canReturn404: true,
  },
  {
    method: "delete",
    path: "/api/v1/workspaces/{workspaceId}/messages/{messageId}",
    operationId: "deleteMessage",
    summary: "Delete a message",
    description: "Delete a message previously sent by this API key's bot.",
    tags: ["Messages"],
    scopes: [API_KEY_SCOPES.MESSAGES_WRITE],
    parameters: [workspaceIdParam, messageIdParam],
    responseSchema: z.void(),
    successStatus: 204,
    canReturn404: true,
  },

  // --- Users ---
  {
    method: "get",
    path: "/api/v1/workspaces/{workspaceId}/users",
    operationId: "listUsers",
    summary: "List workspace users",
    description: "List users in the workspace with optional text search and cursor pagination.",
    tags: ["Users"],
    scopes: [API_KEY_SCOPES.USERS_READ],
    parameters: [workspaceIdParam],
    requestSchema: listUsersSchema,
    requestIn: "query",
    responseSchema: paginated(userSchema),
  },
]

// Export response schemas for tests and derived wire types for serializers
export { streamSchema, messageSchema, searchResultSchema, memberSchema, userSchema, errorSchema }

// Wire types derived from schemas — serializers annotate their return types with these
export type WireStream = z.infer<typeof streamSchema>
export type WireMessage = z.infer<typeof messageSchema>
export type WireSearchResult = z.infer<typeof searchResultSchema>
export type WireMember = z.infer<typeof memberSchema>
export type WireUser = z.infer<typeof userSchema>
