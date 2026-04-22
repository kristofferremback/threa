import { ContextIntents, ContextRefKinds } from "@threa/types"
import type { IntentConfig } from "../types"

/**
 * "Discuss with Ariadne": start a private scratchpad side-conversation with a
 * thread loaded as context. Intent config drives the system-prompt preamble,
 * the orientation-turn template, and the inline-vs-summary threshold.
 *
 * The preamble explicitly tells the model that the volatile "Since last turn"
 * section overrides the main body — small prompt cost, but required to make
 * the append-only stable region safe when source messages are edited.
 */
export const DiscussThreadIntent: IntentConfig = {
  intent: ContextIntents.DISCUSS_THREAD,
  inlineCharThreshold: 8_000,
  supportedKinds: [ContextRefKinds.THREAD],
  systemPreamble: [
    "You are loaded with a private side-conversation about an existing thread.",
    "The thread's messages are attached below as context so you can answer questions about it.",
    "Cite specific messages using their bracketed ids (for example `[msg_abc]`) when you reference them.",
    "",
    "If a message appears in both the main context body and the `## Since last turn` section,",
    "treat the `## Since last turn` version as authoritative — the main body is kept stable",
    "across turns to preserve prompt-cache reuse, so in-place edits flow through the delta block.",
  ].join("\n"),
  orientationUserPrompt: [
    "You've just been loaded with the thread above. Before the user types anything, write a single short orienting message:",
    "1. Briefly restate what the thread is about (one or two sentences).",
    "2. Call out any open questions or unresolved points you noticed, with message-id citations.",
    "3. Invite the user to dig in with a specific question.",
    "",
    "Stay neutral and factual — no opinions or recommendations on this first turn.",
  ].join("\n"),
}
