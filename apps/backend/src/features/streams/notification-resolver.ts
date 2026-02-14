import type { Querier } from "../../db"
import type { NotificationLevel } from "@threa/types"
import type { Stream } from "./repository"
import type { StreamMember } from "./member-repository"
import { StreamRepository } from "./repository"
import { StreamMemberRepository } from "./member-repository"
import { getDefaultLevel } from "./notification-config"

export interface ResolvedNotification {
  memberId: string
  effectiveLevel: NotificationLevel
  source: "explicit" | "inherited" | "default"
}

/**
 * Resolve effective notification level for a single member in a stream.
 */
export async function resolveNotificationLevel(
  db: Querier,
  stream: Stream,
  memberId: string
): Promise<ResolvedNotification> {
  const membership = await StreamMemberRepository.findByStreamAndMember(db, stream.id, memberId)
  if (!membership) {
    return { memberId, effectiveLevel: getDefaultLevel(stream.type), source: "default" }
  }

  if (membership.notificationLevel) {
    return { memberId, effectiveLevel: membership.notificationLevel, source: "explicit" }
  }

  // Walk up parentStreamId chain (max 2 hops)
  const inherited = await walkAncestors(db, stream, memberId)
  if (inherited) {
    return { memberId, effectiveLevel: inherited, source: "inherited" }
  }

  return { memberId, effectiveLevel: getDefaultLevel(stream.type), source: "default" }
}

/**
 * Batch-resolve notification levels for all members of a stream.
 * Optimized: fetches ancestry chain once, batch-fetches ancestor memberships.
 */
export async function resolveNotificationLevelsForStream(
  db: Querier,
  stream: Stream,
  members: StreamMember[]
): Promise<ResolvedNotification[]> {
  if (members.length === 0) return []

  // Collect members with explicit levels vs those needing resolution
  const resolved: ResolvedNotification[] = []
  const needsResolution: StreamMember[] = []

  for (const member of members) {
    if (member.notificationLevel) {
      resolved.push({ memberId: member.memberId, effectiveLevel: member.notificationLevel, source: "explicit" })
    } else {
      needsResolution.push(member)
    }
  }

  if (needsResolution.length === 0) return resolved

  // Build ancestry chain (max 2 hops)
  const ancestors = await getAncestorChain(db, stream, 2)
  if (ancestors.length === 0) {
    // No ancestors — all unresolved members get stream-type default
    for (const member of needsResolution) {
      resolved.push({ memberId: member.memberId, effectiveLevel: getDefaultLevel(stream.type), source: "default" })
    }
    return resolved
  }

  // Batch-fetch ancestor memberships: one list query per ancestor, filtered in-memory
  const memberIdSet = new Set(needsResolution.map((m) => m.memberId))
  const ancestorMemberships = new Map<string, Map<string, StreamMember>>()

  for (const ancestor of ancestors) {
    const allMemberships = await StreamMemberRepository.list(db, { streamId: ancestor.id })
    const memberMap = new Map<string, StreamMember>()
    for (const m of allMemberships) {
      if (memberIdSet.has(m.memberId)) {
        memberMap.set(m.memberId, m)
      }
    }
    ancestorMemberships.set(ancestor.id, memberMap)
  }

  // Resolve each unresolved member
  for (const member of needsResolution) {
    let inherited: NotificationLevel | null = null

    for (const ancestor of ancestors) {
      const ancestorMembership = ancestorMemberships.get(ancestor.id)?.get(member.memberId)
      if (!ancestorMembership?.notificationLevel) continue

      const level = ancestorMembership.notificationLevel
      if (level === "everything") {
        inherited = "activity" // everything cascades down as activity
        break
      }
      if (level === "muted") {
        inherited = "muted"
        break
      }
      // mentions or activity — stop walking, don't cascade
      break
    }

    if (inherited) {
      resolved.push({ memberId: member.memberId, effectiveLevel: inherited, source: "inherited" })
    } else {
      resolved.push({
        memberId: member.memberId,
        effectiveLevel: getDefaultLevel(stream.type),
        source: "default",
      })
    }
  }

  return resolved
}

/**
 * Walk up parentStreamId chain to find an inherited notification level.
 * Max 2 hops to prevent runaway queries.
 */
async function walkAncestors(db: Querier, stream: Stream, memberId: string): Promise<NotificationLevel | null> {
  let currentStream = stream
  let hops = 0

  while (currentStream.parentStreamId && hops < 2) {
    const parent = await StreamRepository.findById(db, currentStream.parentStreamId)
    if (!parent) break

    const parentMembership = await StreamMemberRepository.findByStreamAndMember(db, parent.id, memberId)
    if (parentMembership?.notificationLevel) {
      const level = parentMembership.notificationLevel
      if (level === "everything") return "activity"
      if (level === "muted") return "muted"
      // mentions or activity — stop walking
      return null
    }

    currentStream = parent
    hops++
  }

  return null
}

/**
 * Get the chain of ancestor streams (parent, grandparent, etc.), max depth hops.
 */
async function getAncestorChain(db: Querier, stream: Stream, maxHops: number): Promise<Stream[]> {
  const ancestors: Stream[] = []
  let currentStream = stream

  while (currentStream.parentStreamId && ancestors.length < maxHops) {
    const parent = await StreamRepository.findById(db, currentStream.parentStreamId)
    if (!parent) break
    ancestors.push(parent)
    currentStream = parent
  }

  return ancestors
}
