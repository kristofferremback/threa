import type { Querier } from "../../../db"
import type { StreamType } from "@threa/types"
import { StreamTypes, Visibilities } from "@threa/types"
import { StreamRepository, type Stream } from "../../streams"
import { StreamMemberRepository } from "../../streams"

/**
 * Specifies what streams an agent can access based on invocation context.
 *
 * This is different from user access - agent access depends on WHERE the agent
 * was invoked, not just WHO invoked it.
 *
 * Examples:
 * - Private scratchpad: agent sees everything the user can see
 * - Public channel: agent sees only public content
 * - DM: agent sees union of all participants' access
 * - Private channel: agent sees public content + current channel
 */
export type AgentAccessSpec =
  | { type: "member_full_access"; memberId: string }
  | { type: "public_only" }
  | { type: "public_plus_stream"; streamId: string }
  | { type: "member_union"; memberIds: string[] }

export interface ComputeAccessSpecParams {
  stream: Stream
  invokingMemberId: string
}

/**
 * Compute the access spec for an agent based on invocation context.
 *
 * Rules:
 * - Private scratchpad: Full user access (user's scratchpads, channels, DMs, etc.)
 * - Public scratchpad: Only public streams
 * - Private channel: Public streams + this channel (and its threads)
 * - Public channel: Only public streams
 * - DM: Union of all DM participants' access
 * - Thread: Inherits from root stream
 */
export async function computeAgentAccessSpec(db: Querier, params: ComputeAccessSpecParams): Promise<AgentAccessSpec> {
  const { stream, invokingMemberId } = params

  // For threads, compute based on root stream
  const effectiveStream = stream.rootStreamId ? await StreamRepository.findById(db, stream.rootStreamId) : stream

  if (!effectiveStream) {
    // Orphaned thread - fall back to public only
    return { type: "public_only" }
  }

  switch (effectiveStream.type) {
    case StreamTypes.SCRATCHPAD:
      // Private scratchpad: member sees everything they can access
      // Public scratchpad: anyone can see, so agent only sees public
      return effectiveStream.visibility === Visibilities.PRIVATE
        ? { type: "member_full_access", memberId: invokingMemberId }
        : { type: "public_only" }

    case StreamTypes.CHANNEL:
      // Private channel: public streams + this channel
      // Public channel: only public streams
      return effectiveStream.visibility === Visibilities.PRIVATE
        ? { type: "public_plus_stream", streamId: effectiveStream.id }
        : { type: "public_only" }

    case StreamTypes.DM: {
      // DM: Union of all participants' access
      const members = await StreamMemberRepository.list(db, { streamId: effectiveStream.id })
      const memberIds = members.map((m) => m.memberId)
      return { type: "member_union", memberIds }
    }

    default:
      return { type: "public_only" }
  }
}

/**
 * Get a human-readable description of the access spec for debugging.
 */
export function describeAccessSpec(spec: AgentAccessSpec): string {
  switch (spec.type) {
    case "member_full_access":
      return `full access for member ${spec.memberId}`
    case "public_only":
      return "public streams only"
    case "public_plus_stream":
      return `public streams + stream ${spec.streamId}`
    case "member_union":
      return `union of ${spec.memberIds.length} members' access`
  }
}

/**
 * Options for getting accessible streams.
 */
export interface GetAccessibleStreamsOptions {
  streamTypes?: StreamType[]
}
