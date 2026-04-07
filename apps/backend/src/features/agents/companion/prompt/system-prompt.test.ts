import { describe, expect, test } from "bun:test"
import { StreamTypes } from "@threa/types"
import type { Persona } from "../../persona-repository"
import type { StreamContext } from "../../context-builder"
import { buildSystemPrompt } from "./system-prompt"

const persona: Persona = {
  id: "persona_ariadne",
  workspaceId: null,
  slug: "ariadne",
  name: "Ariadne",
  description: null,
  avatarEmoji: null,
  systemPrompt: "Base system prompt",
  model: "openai/gpt-5.4",
  temperature: 0.2,
  maxTokens: 1000,
  enabledTools: null,
  managedBy: "system",
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
}

const scratchpadContext: StreamContext = {
  streamType: StreamTypes.SCRATCHPAD,
  streamInfo: {
    name: "Ideas",
    description: null,
    slug: null,
  },
  conversationHistory: [],
}

describe("buildSystemPrompt", () => {
  test("injects scratchpad custom instructions immediately after the base system prompt", () => {
    const prompt = buildSystemPrompt(persona, scratchpadContext, "Be concise and prioritize concrete next steps.")

    expect(prompt).toContain("Base system prompt\n\n## Scratchpad Custom Instructions")
    expect(prompt).toContain("Be concise and prioritize concrete next steps.")
    expect(prompt.indexOf("## Scratchpad Custom Instructions")).toBeLessThan(prompt.indexOf("## Context"))
  })

  test("omits the custom instruction section when no scratchpad prompt exists", () => {
    const prompt = buildSystemPrompt(persona, scratchpadContext, null)

    expect(prompt).not.toContain("## Scratchpad Custom Instructions")
  })
})
