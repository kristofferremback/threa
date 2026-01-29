/**
 * Companion Agent Evaluation Suite
 *
 * Tests the companion agent's response quality across different contexts.
 * Uses the PRODUCTION PersonaAgent.run() directly - no duplicated prompts or graphs.
 *
 * ## Usage
 *
 *   # Run all companion tests
 *   bun run eval -- -s companion
 *
 *   # Run specific cases
 *   bun run eval -- -s companion -c scratchpad-companion-greeting-001
 *
 *   # Compare models
 *   bun run eval -- -s companion -m openrouter:anthropic/claude-haiku-4.5,openrouter:openai/gpt-4.1-mini
 *
 * ## Case ID Format
 *
 * Case IDs follow the pattern: {stream_type}-{trigger}-{category}-{number}
 * Examples:
 *   - scratchpad-companion-greeting-001
 *   - channel-mention-help-001
 *   - dm-companion-casual-001
 */

import type { EvalSuite, EvalContext } from "../../framework/types"
import { companionCases, type CompanionInput, type CompanionExpected } from "./cases"
import type { CompanionOutput, CompanionMessage } from "./types"
import {
  shouldRespondEvaluator,
  contentContainsEvaluator,
  contentNotContainsEvaluator,
  brevityEvaluator,
  asksQuestionEvaluator,
  webSearchUsageEvaluator,
  createResponseQualityEvaluator,
  createToneEvaluator,
  accuracyEvaluator,
  responseDecisionAccuracyEvaluator,
  averageQualityEvaluator,
} from "./evaluators"
import { COMPANION_MODEL_ID, COMPANION_TEMPERATURE } from "../../../src/agents/companion/config"
import { PersonaAgent, type PersonaAgentInput, type PersonaAgentDeps } from "../../../src/agents/persona-agent"
import { LangGraphResponseGenerator } from "../../../src/agents/companion-runner"
import { Researcher } from "../../../src/agents/researcher/researcher"
import { SearchService } from "../../../src/services/search-service"
import { UserPreferencesService } from "../../../src/services/user-preferences-service"
import { EmbeddingService } from "../../../src/services/embedding-service"
import { StreamRepository } from "../../../src/repositories/stream-repository"
import { StreamMemberRepository } from "../../../src/repositories/stream-member-repository"
import { MessageRepository } from "../../../src/repositories/message-repository"
import { PersonaRepository } from "../../../src/repositories/persona-repository"
import { createPostgresCheckpointer } from "../../../src/lib/ai"
import { TraceEmitter } from "../../../src/lib/trace-emitter"
import { EventService } from "../../../src/services/event-service"
import type { Server } from "socket.io"
import { parseMarkdown } from "@threa/prosemirror"
import { AuthorTypes, AgentTriggers, StreamTypes } from "@threa/types"
import { ulid } from "ulid"
import { personaId as generatePersonaId, streamId as generateStreamId } from "../../../src/lib/id"

/** The production Ariadne system persona ID */
const ARIADNE_PERSONA_ID = "persona_system_ariadne"

/**
 * Get model configuration from context.
 * Uses permutation override if provided, otherwise production defaults.
 */
function getModelConfig(ctx: EvalContext): { model: string; temperature: number } {
  const override = ctx.componentOverrides?.["companion"]
  return {
    model: override?.model ?? ctx.permutation.model,
    temperature: override?.temperature ?? ctx.permutation.temperature ?? COMPANION_TEMPERATURE,
  }
}

/**
 * Set up test data for a companion eval case.
 * Creates persona, stream, and trigger message in the database.
 */
async function setupTestData(
  input: CompanionInput,
  ctx: EvalContext
): Promise<{
  personaId: string
  streamId: string
  messageId: string
}> {
  const pool = ctx.pool
  const modelConfig = getModelConfig(ctx)

  // Read the production Ariadne persona to get its system prompt
  // This ensures evals use the EXACT production prompt (INV-44)
  const productionPersona = await PersonaRepository.findById(pool, ARIADNE_PERSONA_ID)
  if (!productionPersona) {
    throw new Error(`Production persona ${ARIADNE_PERSONA_ID} not found - ensure migrations have run`)
  }
  if (!productionPersona.systemPrompt) {
    throw new Error(`Production persona ${ARIADNE_PERSONA_ID} has no system prompt`)
  }

  // Create a test persona with production's system prompt but eval's model
  const testPersonaId = generatePersonaId()
  await pool.query(
    `
    INSERT INTO personas (id, workspace_id, slug, name, description, avatar_emoji, system_prompt, model, enabled_tools, managed_by, status)
    VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, 'system', 'active')
    ON CONFLICT (slug, workspace_id) WHERE workspace_id IS NULL DO UPDATE SET
      model = EXCLUDED.model,
      system_prompt = EXCLUDED.system_prompt
  `,
    [
      testPersonaId,
      `eval-ariadne-${ulid().toLowerCase().slice(0, 8)}`,
      "Ariadne (Eval)",
      productionPersona.description,
      productionPersona.avatarEmoji,
      productionPersona.systemPrompt,
      modelConfig.model,
      productionPersona.enabledTools ?? ["send_message"],
    ]
  )

  // Map stream type from eval input to database type
  const dbStreamType =
    input.streamType === "scratchpad"
      ? StreamTypes.SCRATCHPAD
      : input.streamType === "channel"
        ? StreamTypes.CHANNEL
        : input.streamType === "thread"
          ? StreamTypes.THREAD
          : input.streamType === "dm"
            ? StreamTypes.DM
            : StreamTypes.SCRATCHPAD

  // Create the stream
  const testStreamId = generateStreamId()
  await StreamRepository.insert(pool, {
    id: testStreamId,
    workspaceId: ctx.workspaceId,
    type: dbStreamType,
    displayName: input.streamContext?.name ?? `Eval ${input.streamType}`,
    slug: input.streamType === "channel" ? `eval-${ulid().toLowerCase().slice(0, 8)}` : undefined,
    description: input.streamContext?.description,
    visibility: "private",
    companionMode: input.trigger === "companion" ? "on" : "off",
    companionPersonaId: input.trigger === "companion" ? testPersonaId : undefined,
    createdBy: ctx.userId,
  })

  // Add user as stream member
  await StreamMemberRepository.insert(pool, testStreamId, ctx.userId)

  // Create event service for message creation
  const eventService = new EventService(pool)

  // Create conversation history if provided
  if (input.conversationHistory && input.conversationHistory.length > 0) {
    for (const msg of input.conversationHistory) {
      const authorId = msg.role === "user" ? ctx.userId : testPersonaId
      const authorType = msg.role === "user" ? AuthorTypes.USER : AuthorTypes.PERSONA
      await eventService.createMessage({
        workspaceId: ctx.workspaceId,
        streamId: testStreamId,
        authorId,
        authorType,
        contentJson: parseMarkdown(msg.content),
        contentMarkdown: msg.content,
      })
    }
  }

  // Create the trigger message
  const triggerMessage = await eventService.createMessage({
    workspaceId: ctx.workspaceId,
    streamId: testStreamId,
    authorId: ctx.userId,
    authorType: AuthorTypes.USER,
    contentJson: parseMarkdown(input.message),
    contentMarkdown: input.message,
  })

  return {
    personaId: testPersonaId,
    streamId: testStreamId,
    messageId: triggerMessage.id,
  }
}

/**
 * Task function that runs the companion agent using production code paths.
 *
 * Uses PersonaAgent.run() directly - the same code path as production.
 * No duplicated prompts, no manual graph creation.
 */
async function runCompanionTask(input: CompanionInput, ctx: EvalContext): Promise<CompanionOutput> {
  // Skip empty messages
  if (!input.message.trim()) {
    return {
      input,
      messages: [],
      responded: false,
    }
  }

  try {
    // Set up test data in the database
    const { personaId, streamId, messageId } = await setupTestData(input, ctx)

    // Create dependencies for PersonaAgent
    const checkpointer = await createPostgresCheckpointer(ctx.pool)
    const embeddingService = new EmbeddingService({ ai: ctx.ai })
    const userPreferencesService = new UserPreferencesService(ctx.pool)
    const researcher = new Researcher({
      pool: ctx.pool,
      ai: ctx.ai,
      configResolver: ctx.configResolver,
      embeddingService,
    })
    const searchService = new SearchService({
      pool: ctx.pool,
      embeddingService,
    })

    const responseGenerator = new LangGraphResponseGenerator({
      ai: ctx.ai,
      checkpointer,
      // No tavilyApiKey - web search disabled for evals
      costRecorder: undefined,
    })

    // Stub Socket.io server for tracing - evals don't need real-time updates
    const stubIo = { to: () => ({ to: () => ({ emit: () => {} }), emit: () => {} }) } as unknown as Server
    const traceEmitter = new TraceEmitter({ io: stubIo, pool: ctx.pool })

    // Create message and thread callbacks using EventService
    const evalEventService = new EventService(ctx.pool)

    const createMessage: PersonaAgentDeps["createMessage"] = async (params) => {
      const message = await evalEventService.createMessage({
        workspaceId: params.workspaceId,
        streamId: params.streamId,
        authorId: params.authorId,
        authorType: params.authorType,
        contentJson: parseMarkdown(params.content),
        contentMarkdown: params.content,
        sources: params.sources,
      })
      return { id: message.id }
    }

    const createThread: PersonaAgentDeps["createThread"] = async (params) => {
      // For evals, we don't actually need threads - return a mock
      const threadId = generateStreamId()
      await StreamRepository.insert(ctx.pool, {
        id: threadId,
        workspaceId: params.workspaceId,
        type: StreamTypes.THREAD,
        visibility: "private",
        companionMode: "off",
        createdBy: params.createdBy,
        parentStreamId: params.parentStreamId,
        parentMessageId: params.parentMessageId,
      })
      return { id: threadId }
    }

    // Create PersonaAgent with real dependencies
    const personaAgent = new PersonaAgent({
      pool: ctx.pool,
      traceEmitter,
      responseGenerator,
      userPreferencesService,
      researcher,
      searchService,
      createMessage,
      createThread,
    })

    // Build PersonaAgentInput
    const agentInput: PersonaAgentInput = {
      workspaceId: ctx.workspaceId,
      streamId,
      messageId,
      personaId,
      serverId: `eval-server-${ulid()}`,
      trigger: input.trigger === "mention" ? AgentTriggers.MENTION : undefined,
    }

    // Run the agent!
    await personaAgent.run(agentInput)

    // Read back messages sent by the agent
    const allMessages = await MessageRepository.list(ctx.pool, streamId, { limit: 100 })
    const agentMessages = allMessages.filter((m) => m.authorId === personaId)

    const messages: CompanionMessage[] = agentMessages.map((m) => ({
      content: m.contentMarkdown,
      // Sources are stored in contentJson but we just need content for evals
    }))

    return {
      input,
      messages,
      responded: messages.length > 0,
    }
  } catch (error) {
    return {
      input,
      messages: [],
      responded: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Companion Agent Evaluation Suite
 */
export const companionSuite: EvalSuite<CompanionInput, CompanionOutput, CompanionExpected> = {
  name: "companion",
  description: "Evaluates companion agent response quality across different contexts",

  cases: companionCases,

  task: runCompanionTask,

  evaluators: [
    shouldRespondEvaluator,
    contentContainsEvaluator,
    contentNotContainsEvaluator,
    brevityEvaluator,
    asksQuestionEvaluator,
    webSearchUsageEvaluator,
    createResponseQualityEvaluator(),
    createToneEvaluator(),
  ],

  runEvaluators: [accuracyEvaluator, responseDecisionAccuracyEvaluator, averageQualityEvaluator],

  defaultPermutations: [
    {
      model: COMPANION_MODEL_ID,
      temperature: COMPANION_TEMPERATURE,
    },
  ],
}

export default companionSuite
