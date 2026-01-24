/**
 * Companion Agent Evaluation Suite
 *
 * Tests the companion agent's response quality across different contexts:
 * - Stream types: scratchpad, channel, thread, dm
 * - Triggers: companion mode, @mention
 * - Message types: greetings, questions, tasks, information sharing
 */

export { companionSuite, default } from "./suite"
export * from "./config"
export * from "./types"
export * from "./cases"
export * from "./evaluators"
