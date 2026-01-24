/**
 * Companion Eval Suite Configuration
 *
 * Eval-specific config only. Production config imported from src/agents/companion/config.ts
 */

// Re-export production config for suite usage
export { COMPANION_MODEL_ID, COMPANION_TEMPERATURE } from "../../../src/agents/companion/config"

// Re-export agent triggers for eval cases (canonical definition in @threa/types)
export { AGENT_TRIGGERS as INVOCATION_TRIGGERS, type AgentTrigger as InvocationTrigger } from "@threa/types"
