import { StreamTypes } from "@threa/types"
import type { StreamContext } from "../../context-builder"

/**
 * Build prompt section for scratchpads.
 * Personal, solo-first context. Conversation history is primary.
 */
export function buildScratchpadPrompt(context: StreamContext, workspaceResearchEnabled: boolean): string {
  let section = "\n\n## Context\n\n"
  section += "You are in a personal scratchpad"

  if (context.streamInfo.name) {
    section += ` called "${context.streamInfo.name}"`
  }
  section += ". This is a private, personal space for notes and thinking."

  if (context.streamInfo.description) {
    section += `\n\nDescription: ${context.streamInfo.description}`
  }

  section += `

## Workspace Knowledge Access

You have access to the user's workspace knowledge through the GAM (General Agentic Memory) system:
- Their other scratchpads and notes
- Channels they're a member of
- DMs they're participating in
- Memos (summarized knowledge) from past conversations

`

  if (workspaceResearchEnabled) {
    section += `Use the \`workspace_research\` tool when you need this additional context. If a "Retrieved Knowledge" section appears below, it contains information found relevant to this conversation. You can reference this knowledge naturally without explicitly citing sources unless the user asks where information came from.`
  } else {
    section += `Workspace research is not available in this run, so rely on the active conversation context and ask follow-up questions when needed.`
  }

  return section
}

/**
 * Build prompt section for channels.
 * Collaborative context with member awareness.
 */
export function buildChannelPrompt(context: StreamContext): string {
  let section = "\n\n## Context\n\n"
  section += "You are in a channel"

  if (context.streamInfo.name) {
    section += ` called "${context.streamInfo.name}"`
  }
  if (context.streamInfo.slug) {
    section += ` (#${context.streamInfo.slug})`
  }
  section += ". This is a collaborative space where team members can discuss topics together."

  if (context.streamInfo.description) {
    section += `\n\nChannel description: ${context.streamInfo.description}`
  }

  if (context.participants && context.participants.length > 0) {
    section += "\n\nChannel members:\n"
    for (const p of context.participants) {
      section += `- ${p.name}\n`
    }
  }

  return section
}

/**
 * Build prompt section for threads.
 * Nested discussion with hierarchy awareness.
 */
export function buildThreadPrompt(context: StreamContext): string {
  let section = "\n\n## Context\n\n"
  section += "You are in a thread"

  if (context.streamInfo.name) {
    section += ` called "${context.streamInfo.name}"`
  }
  section += ". This is a focused discussion branching from a parent conversation."

  if (context.streamInfo.description) {
    section += `\n\nThread description: ${context.streamInfo.description}`
  }

  // Add thread hierarchy context
  if (context.threadContext && context.threadContext.path.length > 1) {
    section += `\n\nThread hierarchy (${context.threadContext.depth} levels deep):\n`

    for (let i = 0; i < context.threadContext.path.length; i++) {
      const entry = context.threadContext.path[i]
      const indent = "  ".repeat(i)
      const name = entry.displayName ?? "Untitled"

      if (i === 0) {
        section += `${indent}[Root] ${name}\n`
      } else if (i === context.threadContext.path.length - 1) {
        section += `${indent}[Current] ${name}\n`
      } else {
        section += `${indent}└─ ${name}\n`
      }

      if (entry.anchorMessage) {
        section += `${indent}   Spawned from: "${entry.anchorMessage.content}" (by ${entry.anchorMessage.authorName})\n`
      }
    }
  }

  return section
}

/**
 * Build prompt section for DMs.
 * Two-party context, more focused than channels.
 */
export function buildDmPrompt(context: StreamContext): string {
  let section = "\n\n## Context\n\n"
  section += "You are in a direct message conversation"

  if (context.participants && context.participants.length > 0) {
    const names = context.participants.map((p) => p.name).join(" and ")
    section += ` between ${names}`
  }
  section += ". This is a private, focused conversation between two people."

  if (context.streamInfo.description) {
    section += `\n\nDescription: ${context.streamInfo.description}`
  }

  return section
}

export function buildPromptSectionForStreamType(context: StreamContext, workspaceResearchEnabled: boolean): string {
  switch (context.streamType) {
    case StreamTypes.SCRATCHPAD:
      return buildScratchpadPrompt(context, workspaceResearchEnabled)
    case StreamTypes.CHANNEL:
      return buildChannelPrompt(context)
    case StreamTypes.THREAD:
      return buildThreadPrompt(context)
    case StreamTypes.DM:
      return buildDmPrompt(context)
    default:
      return buildScratchpadPrompt(context, workspaceResearchEnabled)
  }
}
