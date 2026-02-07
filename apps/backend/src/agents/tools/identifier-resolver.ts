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
import { MemberRepository } from "../../repositories/member-repository"
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
 * Check if a string looks like a member ID (starts with member_ prefix).
 */
function isMemberId(value: string): boolean {
  return value.startsWith("member_")
}

/**
 * Strip common prefixes from stream references.
 * "#general" -> "general"
 */
function normalizeStreamRef(value: string): string {
  return value.replace(/^#/, "").trim()
}

/**
 * Strip common prefixes from member references.
 * "@kristoffer-remback" -> "kristoffer-remback"
 */
function normalizeMemberRef(value: string): string {
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
 * Resolve a member identifier to their ID.
 *
 * @param db - Database client
 * @param workspaceId - Workspace to scope the lookup to
 * @param identifier - Member ID, slug, or @slug
 * @returns The resolved member ID or an error reason
 *
 * @example
 * // All of these should resolve to the same member:
 * resolveMemberIdentifier(db, workspaceId, "member_01KEM8751NC7E01NTKF00A47BM")
 * resolveMemberIdentifier(db, workspaceId, "kristoffer-remback")
 * resolveMemberIdentifier(db, workspaceId, "@kristoffer-remback")
 */
export async function resolveMemberIdentifier(
  db: Querier,
  workspaceId: string,
  identifier: string
): Promise<ResolveResult> {
  const trimmed = identifier.trim()

  if (!trimmed) {
    return { resolved: false, reason: "Empty identifier" }
  }

  // If it looks like a member ID, validate it exists in this workspace
  if (isMemberId(trimmed)) {
    const member = await MemberRepository.findById(db, trimmed)
    if (!member || member.workspaceId !== workspaceId) {
      return { resolved: false, reason: `No member found with ID: ${trimmed}` }
    }
    return { resolved: true, id: trimmed }
  }

  // Otherwise, treat as slug (strip @ prefix if present)
  const slug = normalizeMemberRef(trimmed)

  const member = await MemberRepository.findBySlug(db, workspaceId, slug)

  if (!member) {
    return { resolved: false, reason: `No member found with slug: ${slug}` }
  }

  logger.debug({ identifier, resolvedId: member.id, slug }, "Resolved member identifier")

  return { resolved: true, id: member.id }
}
