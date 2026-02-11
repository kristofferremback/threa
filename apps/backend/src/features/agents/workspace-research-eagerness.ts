import type { StreamType } from "@threa/types"

const TRIVIAL_MESSAGE_PATTERN =
  /^(?:hi|hey|hello|thanks|thank you|ty|ok|okay|got it|nice|cool|sounds good|👍|🙏)[.!?\s]*$/i

const MEMORY_RECALL_PATTERNS = [
  /\b(do you remember|remember|recall|remind me)\b/i,
  /\b(what did we|did we|have we|who owns|who owned|where did we|when did we)\b/i,
  /\b(we decided|we agreed|we chose|as discussed|from earlier|from before)\b/i,
  /\b(previous|earlier|again|last time|last meeting|yesterday)\b/i,
]

const MIN_SUBSTANTIVE_LENGTH = 16

export interface WorkspaceResearchEagernessInput {
  streamType?: StreamType
  latestUserMessage: string
}

/**
 * Heuristic for when to prefetch workspace research before the first LLM turn.
 *
 * This keeps research on-demand while making memory checks more eager for
 * memory-oriented questions and substantive scratchpad prompts.
 */
export function shouldEagerlyPrefetchWorkspaceResearch(input: WorkspaceResearchEagernessInput): boolean {
  const text = input.latestUserMessage.trim()
  if (!text) {
    return false
  }

  if (TRIVIAL_MESSAGE_PATTERN.test(text) && text.length <= 80) {
    return false
  }

  if (MEMORY_RECALL_PATTERNS.some((pattern) => pattern.test(text))) {
    return true
  }

  if (input.streamType === "scratchpad" && text.length >= MIN_SUBSTANTIVE_LENGTH) {
    return true
  }

  return false
}
