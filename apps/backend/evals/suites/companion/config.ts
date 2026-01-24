/**
 * Companion Eval Suite Configuration
 *
 * Eval-specific config only. Production config imported from src/agents/companion/config.ts
 */

// Re-export production config for suite usage
export { COMPANION_MODEL_ID, COMPANION_TEMPERATURE } from "../../../src/agents/companion/config"

/**
 * Invocation triggers (eval-specific concept for test cases).
 */
export const INVOCATION_TRIGGERS = ["companion", "mention"] as const
export type InvocationTrigger = (typeof INVOCATION_TRIGGERS)[number]
