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
  section += ". This is a private space for notes and thinking."

  if (context.streamInfo.description) {
    section += `\n\nDescription: ${context.streamInfo.description}`
  }

  if (workspaceResearchEnabled) {
    section += `\n\nYou can use the \`workspace_research\` tool to retrieve relevant knowledge from past conversations, scratchpads, and memos. Reference retrieved knowledge naturally without citing sources unless asked.`
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
  section += ". This is a collaborative team space."

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
  section += ". This is a focused thread branching from a parent conversation."

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
  section += "."

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
