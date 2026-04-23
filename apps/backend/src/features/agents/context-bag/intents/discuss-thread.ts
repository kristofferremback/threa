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
    "",
    "Internal ids for messages appear in the context as `[msg_…]` tags. They are for your",
    "grounding only — NEVER include them in your user-facing response. Refer to messages by",
    'author and a short paraphrase (for example: "Kristoffer\'s check-in about the rollout")',
    "rather than pasting ids or raw timestamps.",
    "",
    "If a message appears in both the main context body and the `## Since last turn` section,",
    "treat the `## Since last turn` version as authoritative — the main body is kept stable",
    "across turns to preserve prompt-cache reuse, so in-place edits flow through the delta block.",
  ].join("\n"),
  orientationUserPrompt: [
    "You've just been loaded with the thread above. Before the user types anything, write a single short orienting message.",
    "",
    "Write in a natural, conversational voice. Keep it brief — three or four sentences tops.",
    "- Sketch what the thread is about without restating it line by line.",
    "- If you noticed any unresolved point worth picking up, mention it plainly (refer to people by name, not by id).",
    "- End with a low-friction invitation to dig in, not a list of questions.",
    "",
    "Stay neutral on this first turn — no opinions, recommendations, or framing devices.",
    'Do NOT include headers like "Thread summary:" or "Open points:". Do NOT paste message ids.',
    "If there's essentially nothing in the thread yet, say so in one sentence and invite the user to set the direction.",
  ].join("\n"),
}
