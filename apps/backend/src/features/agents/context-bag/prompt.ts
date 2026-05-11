import type { ResolvedBag } from "./resolve"

/**
 * Fold a resolved ContextBag into the agent's system prompt.
 *
 * The stable region is appended as a persistent grounding block (append-only
 * across turns so it survives prompt-cache reuse). The "Since last turn"
 * delta, when non-empty, is appended after as a volatile override — the
 * intent preamble (see `DiscussThreadIntent.systemPreamble`) tells the model
 * to prefer the delta's version when a message appears in both regions.
 *
 * Identity when `bag` is null: returns the input verbatim so bag-free
 * streams pay zero prompt cost.
 */
export function appendBagToSystemPrompt(systemPrompt: string, bag: ResolvedBag | null): string {
  if (!bag) return systemPrompt
  const parts = [systemPrompt, bag.stable]
  if (bag.delta) parts.push(bag.delta)
  return parts.filter(Boolean).join("\n\n")
}
