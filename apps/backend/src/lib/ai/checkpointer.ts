import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres"
import type { Pool } from "pg"

import { logger } from "../logger"

const LANGGRAPH_SCHEMA = "langgraph"

let checkpointer: PostgresSaver | null = null

/**
 * Initialize the LangGraph PostgreSQL checkpointer.
 *
 * This creates the necessary tables in the `langgraph` schema on first run.
 * Must be called once at server startup before any graph invocations.
 */
export async function initCheckpointer(pool: Pool): Promise<PostgresSaver> {
  if (checkpointer) {
    return checkpointer
  }

  checkpointer = new PostgresSaver(pool, undefined, {
    schema: LANGGRAPH_SCHEMA,
  })

  await checkpointer.setup()
  logger.info({ schema: LANGGRAPH_SCHEMA }, "LangGraph checkpointer initialized")

  return checkpointer
}

/**
 * Get the initialized checkpointer instance.
 *
 * @throws Error if checkpointer was not initialized via initCheckpointer()
 */
export function getCheckpointer(): PostgresSaver {
  if (!checkpointer) {
    throw new Error("Checkpointer not initialized - call initCheckpointer() first")
  }
  return checkpointer
}
