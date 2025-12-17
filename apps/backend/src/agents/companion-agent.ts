import type { Pool, PoolClient } from "pg";
import { withClient } from "../db";
import { AuthorTypes, CompanionModes, type AuthorType } from "../lib/constants";
import { StreamRepository } from "../repositories/stream-repository";
import { MessageRepository } from "../repositories/message-repository";
import {
  PersonaRepository,
  type Persona,
} from "../repositories/persona-repository";
import {
  AgentSessionRepository,
  SessionStatuses,
  type AgentSession,
} from "../repositories/agent-session-repository";
import type { ResponseGenerator } from "./companion-runner";
import { sessionId } from "../lib/id";
import { logger } from "../lib/logger";

const MAX_CONTEXT_MESSAGES = 20;

export type WithSessionResult =
  | { status: "skipped"; sessionId: null; reason: string }
  | { status: "completed"; sessionId: string; responseMessageId: string }
  | { status: "failed"; sessionId: string };

/**
 * Manages the complete lifecycle of an agent session.
 *
 * Handles:
 * - Finding existing or creating new session
 * - Checking if session is already completed (skip)
 * - Running the work callback with a DB client
 * - Marking session as completed or failed based on callback result
 *
 * This encapsulates all session state management so callers only need to
 * provide the work logic. The callback receives a client for any DB operations
 * it needs to perform.
 */
export async function withSession(
  params: {
    pool: Pool;
    triggerMessageId: string;
    streamId: string;
    personaId: string;
    serverId: string;
  },
  work: (
    client: PoolClient,
    session: AgentSession
  ) => Promise<{ responseMessageId: string }>
): Promise<WithSessionResult> {
  const { pool, triggerMessageId, streamId, personaId, serverId } = params;

  return withClient(pool, async (client) => {
    // Find or create session
    let session = await AgentSessionRepository.findByTriggerMessage(
      client,
      triggerMessageId
    );

    if (session?.status === SessionStatuses.COMPLETED) {
      logger.info({ sessionId: session.id }, "Session already completed");
      return {
        status: "skipped" as const,
        sessionId: null,
        reason: "session already completed",
      };
    }

    if (!session) {
      session = await AgentSessionRepository.insert(client, {
        id: sessionId(),
        streamId,
        personaId,
        triggerMessageId,
        status: SessionStatuses.RUNNING,
        serverId,
      });
    } else {
      session = await AgentSessionRepository.updateStatus(
        client,
        session.id,
        SessionStatuses.RUNNING,
        { serverId }
      );
    }

    if (!session) {
      return {
        status: "skipped" as const,
        sessionId: null,
        reason: "failed to create session",
      };
    }

    // Run work and track status
    try {
      const { responseMessageId } = await work(client, session);

      await AgentSessionRepository.updateStatus(
        client,
        session.id,
        SessionStatuses.COMPLETED,
        { responseMessageId }
      );

      logger.info(
        { sessionId: session.id, responseMessageId },
        "Session completed"
      );

      return {
        status: "completed" as const,
        sessionId: session.id,
        responseMessageId,
      };
    } catch (error) {
      logger.error({ error, sessionId: session.id }, "Session failed");

      await AgentSessionRepository.updateStatus(
        client,
        session.id,
        SessionStatuses.FAILED,
        { error: String(error) }
      ).catch((e) => logger.error({ e }, "Failed to mark session as failed"));

      return { status: "failed" as const, sessionId: session.id };
    }
  });
}

/**
 * Dependencies required to construct a CompanionAgent.
 */
export interface CompanionAgentDeps {
  pool: Pool;
  responseGenerator: ResponseGenerator;
  createMessage: (params: {
    workspaceId: string;
    streamId: string;
    authorId: string;
    authorType: AuthorType;
    content: string;
  }) => Promise<{ id: string }>;
}

/**
 * Input parameters for running the companion agent.
 */
export interface CompanionAgentInput {
  streamId: string;
  messageId: string;
  serverId: string;
}

/**
 * Result from running the companion agent.
 */
export interface CompanionAgentResult {
  sessionId: string | null;
  responseMessageId: string | null;
  status: "completed" | "failed" | "skipped";
  skipReason?: string;
}

/**
 * Companion agent that responds to messages in streams.
 *
 * Encapsulates all dependencies so callers only need to call run(input).
 * This enables reuse across different invocation contexts (job workers,
 * API endpoints, evals) without exposing internal dependencies.
 */
export class CompanionAgent {
  constructor(private readonly deps: CompanionAgentDeps) {}

  /**
   * Run the companion agent for a given message in a stream.
   *
   * This is the main orchestration method that:
   * 1. Loads stream context and validates companion mode
   * 2. Resolves the persona to use
   * 3. Creates or resumes an agent session
   * 4. Loads conversation history
   * 5. Generates a response via the response generator
   * 6. Posts the response message
   * 7. Updates session status
   */
  async run(input: CompanionAgentInput): Promise<CompanionAgentResult> {
    const { pool, responseGenerator, createMessage } = this.deps;
    const { streamId, messageId, serverId } = input;

    // Step 1: Load and validate stream/persona
    const precheck = await withClient(pool, async (client) => {
      const stream = await StreamRepository.findById(client, streamId);
      if (!stream || stream.companionMode !== CompanionModes.ON) {
        return {
          skip: true as const,
          reason: "stream not found or companion mode off",
        };
      }

      const persona = await getPersona(client, stream.companionPersonaId);
      if (!persona) {
        logger.error({ streamId }, "No persona found");
        return { skip: true as const, reason: "no persona found" };
      }

      return { skip: false as const, stream, persona };
    });

    if (precheck.skip) {
      return {
        sessionId: null,
        responseMessageId: null,
        status: "skipped",
        skipReason: precheck.reason,
      };
    }

    const { stream, persona } = precheck;

    // Step 2: Run with session lifecycle management
    const result = await withSession(
      {
        pool,
        triggerMessageId: messageId,
        streamId,
        personaId: persona.id,
        serverId,
      },
      async (client, session) => {
        // Load conversation history
        const recentMessages = await MessageRepository.list(client, streamId, {
          limit: MAX_CONTEXT_MESSAGES,
        });

        // Generate response
        const systemPrompt = buildSystemPrompt(persona, stream);
        const aiResult = await responseGenerator.run({
          threadId: session.id,
          modelId: persona.model,
          systemPrompt,
          messages: recentMessages.map((m) => ({
            role:
              m.authorType === AuthorTypes.USER
                ? ("user" as const)
                : ("assistant" as const),
            content: m.content,
          })),
        });

        // Post response
        const responseMessage = await createMessage({
          workspaceId: stream.workspaceId,
          streamId,
          authorId: persona.id,
          authorType: AuthorTypes.PERSONA,
          content: aiResult.response,
        });

        return { responseMessageId: responseMessage.id };
      }
    );

    switch (result.status) {
      case "skipped":
        return {
          sessionId: null,
          responseMessageId: null,
          status: "skipped",
          skipReason: result.reason,
        };

      case "failed":
        return {
          sessionId: result.sessionId,
          responseMessageId: null,
          status: "failed",
        };

      case "completed":
        return {
          sessionId: result.sessionId,
          responseMessageId: result.responseMessageId,
          status: "completed",
        };
    }
  }
}

async function getPersona(
  client: PoolClient,
  personaId: string | null
): Promise<Persona | null> {
  if (personaId) {
    const persona = await PersonaRepository.findById(client, personaId);
    if (persona?.status === "active") {
      return persona;
    }
  }
  return PersonaRepository.getSystemDefault(client);
}

/**
 * Build the system prompt for the companion agent.
 * Requires persona to have a system prompt configured.
 */
function buildSystemPrompt(
  persona: Persona,
  stream: {
    type: string;
    displayName: string | null;
    description: string | null;
  }
): string {
  if (!persona.systemPrompt) {
    throw new Error(
      `Persona "${persona.name}" (${persona.id}) has no system prompt configured`
    );
  }

  let prompt = persona.systemPrompt;

  prompt += `\n\nYou are currently in a ${stream.type}`;
  if (stream.displayName) {
    prompt += ` called "${stream.displayName}"`;
  }
  if (stream.description) {
    prompt += `: ${stream.description}`;
  }
  prompt += ".";

  prompt += `\n\nBe helpful, concise, and conversational.`;

  return prompt;
}
