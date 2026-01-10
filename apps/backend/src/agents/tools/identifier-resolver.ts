/**
 * Identifier Resolver
 *
 * Resolves flexible identifiers (IDs, slugs, or prefixed references) to actual entity IDs.
 * This allows agents to reference entities naturally without knowing the exact ID format.
 *
 * Supported formats:
 * - Streams: "stream_xxx" (ID), "general" (slug), "#general" (prefixed slug)
 * - Users: "usr_xxx" (ID), "kristoffer-remback" (slug), "@kristoffer-remback" (prefixed slug)
 */

import type { Querier } from "../../db"
import { StreamRepository } from "../../repositories/stream-repository"
import { UserRepository } from "../../repositories/user-repository"
import { logger } from "../../lib/logger"

/**
 * Result of resolving an identifier.
 */
export type ResolveResult = { resolved: true; id: string } | { resolved: false; reason: string }

/**
 * Check if a string looks like a stream ID (starts with stream_ prefix).
 */
function isStreamId(value: string): boolean {
  return value.startsWith("stream_")
}

/**
 * Check if a string looks like a user ID (starts with usr_ prefix).
 */
function isUserId(value: string): boolean {
  return value.startsWith("usr_")
}

/**
 * Strip common prefixes from stream references.
 * "#general" -> "general"
 */
function normalizeStreamRef(value: string): string {
  return value.replace(/^#/, "").trim()
}

/**
 * Strip common prefixes from user references.
 * "@kristoffer-remback" -> "kristoffer-remback"
 */
function normalizeUserRef(value: string): string {
  return value.replace(/^@/, "").trim()
}

/**
 * Resolve a stream identifier to its ID.
 *
 * @param db - Database client
 * @param workspaceId - Workspace to scope the lookup to
 * @param identifier - Stream ID, slug, or #slug
 * @param accessibleStreamIds - Optional list of streams the agent can access (for validation)
 * @returns The resolved stream ID or an error reason
 *
 * @example
 * // All of these should resolve to the same stream:
 * resolveStreamIdentifier(db, workspaceId, "stream_01KEM8751NC7E01NTKF00A47BM")
 * resolveStreamIdentifier(db, workspaceId, "general")
 * resolveStreamIdentifier(db, workspaceId, "#general")
 */
export async function resolveStreamIdentifier(
  db: Querier,
  workspaceId: string,
  identifier: string,
  accessibleStreamIds?: string[]
): Promise<ResolveResult> {
  const trimmed = identifier.trim()

  if (!trimmed) {
    return { resolved: false, reason: "Empty identifier" }
  }

  // If it looks like an ID, validate and return
  if (isStreamId(trimmed)) {
    // Check access if we have the list
    if (accessibleStreamIds && !accessibleStreamIds.includes(trimmed)) {
      return { resolved: false, reason: `Stream not accessible: ${trimmed}` }
    }
    return { resolved: true, id: trimmed }
  }

  // Otherwise, treat as slug (strip # prefix if present)
  const slug = normalizeStreamRef(trimmed)

  const stream = await StreamRepository.findBySlug(db, workspaceId, slug)

  if (!stream) {
    return { resolved: false, reason: `No stream found with slug: ${slug}` }
  }

  // Check access if we have the list
  if (accessibleStreamIds && !accessibleStreamIds.includes(stream.id)) {
    return { resolved: false, reason: `Stream not accessible: ${slug}` }
  }

  logger.debug({ identifier, resolvedId: stream.id, slug }, "Resolved stream identifier")

  return { resolved: true, id: stream.id }
}

/**
 * Resolve a user identifier to their ID.
 *
 * @param db - Database client
 * @param workspaceId - Workspace to scope the lookup to
 * @param identifier - User ID, slug, or @slug
 * @returns The resolved user ID or an error reason
 *
 * @example
 * // All of these should resolve to the same user:
 * resolveUserIdentifier(db, workspaceId, "usr_01KEM8751NC7E01NTKF00A47BM")
 * resolveUserIdentifier(db, workspaceId, "kristoffer-remback")
 * resolveUserIdentifier(db, workspaceId, "@kristoffer-remback")
 */
export async function resolveUserIdentifier(
  db: Querier,
  workspaceId: string,
  identifier: string
): Promise<ResolveResult> {
  const trimmed = identifier.trim()

  if (!trimmed) {
    return { resolved: false, reason: "Empty identifier" }
  }

  // If it looks like an ID, validate it exists in this workspace
  if (isUserId(trimmed)) {
    // For ID lookups, verify workspace membership
    const user = await UserRepository.findByIdInWorkspace(db, workspaceId, trimmed)
    if (!user) {
      // Try global lookup to give better error message
      const globalUser = await UserRepository.findById(db, trimmed)
      if (globalUser) {
        return { resolved: false, reason: `User exists but is not a member of this workspace: ${trimmed}` }
      }
      return { resolved: false, reason: `No user found with ID: ${trimmed}` }
    }
    return { resolved: true, id: trimmed }
  }

  // Otherwise, treat as slug (strip @ prefix if present)
  const slug = normalizeUserRef(trimmed)

  const user = await UserRepository.findBySlug(db, workspaceId, slug)

  if (!user) {
    return { resolved: false, reason: `No user found with slug: ${slug}` }
  }

  logger.debug({ identifier, resolvedId: user.id, slug }, "Resolved user identifier")

  return { resolved: true, id: user.id }
}
