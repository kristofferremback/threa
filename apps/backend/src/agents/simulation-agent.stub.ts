import type { SimulationAgentInput, SimulationAgentResult } from "./simulation-agent"
import { logger } from "../lib/logger"

/**
 * Stub simulation agent for test/stub AI environments.
 * Skips LLM work and completes immediately.
 */
export class StubSimulationAgent {
  async run(input: SimulationAgentInput): Promise<SimulationAgentResult> {
    logger.debug({ streamId: input.streamId, turns: input.turns }, "Stub simulation agent - skipping AI run")
    return { status: "completed", messagesSent: 0 }
  }
}
