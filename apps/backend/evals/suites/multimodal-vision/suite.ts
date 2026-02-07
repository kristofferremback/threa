/**
 * Multimodal Vision Evaluation Suite
 *
 * Tests the agent's ability to see and understand images when using vision-capable models.
 * Uses the PRODUCTION PersonaAgent.run() directly - no duplicated prompts or graphs.
 *
 * ## Usage
 *
 *   # Run all vision tests
 *   bun run eval -- -s multimodal-vision
 *
 *   # Run specific cases
 *   bun run eval -- -s multimodal-vision -c vision-red-square-001
 *
 *   # Compare vision models
 *   bun run eval -- -s multimodal-vision -m openrouter:anthropic/claude-sonnet-4.5,openrouter:google/gemini-2.5-flash
 *
 * ## Case ID Format
 *
 * Case IDs follow the pattern: vision-{description}-{number}
 * Examples:
 *   - vision-red-square-001
 *   - vision-describe-image-001
 */

import type { EvalSuite, EvalContext } from "../../framework/types"
import { multimodalVisionCases, type MultimodalVisionInput, type MultimodalVisionExpected } from "./cases"
import type { MultimodalVisionOutput, VisionMessage } from "./types"
import {
  respondedEvaluator,
  contentMentionsEvaluator,
  noHallucinationEvaluator,
  createImageUnderstandingEvaluator,
  visionAccuracyEvaluator,
  averageUnderstandingEvaluator,
  hallucinationRateEvaluator,
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
import { AttachmentRepository } from "../../../src/repositories/attachment-repository"
import { AttachmentExtractionRepository } from "../../../src/repositories/attachment-extraction-repository"
import { createPostgresCheckpointer } from "../../../src/lib/ai"
import { createModelRegistry, type ModelRegistry } from "../../../src/lib/ai/model-registry"
import type { StorageProvider } from "../../../src/lib/storage/s3-client"
import { TraceEmitter } from "../../../src/lib/trace-emitter"
import { EventService } from "../../../src/services/event-service"
import type { Server } from "socket.io"
import { parseMarkdown } from "@threa/prosemirror"
import { AuthorTypes, StreamTypes, ExtractionContentTypes, ProcessingStatuses } from "@threa/types"
import { ulid } from "ulid"
import {
  personaId as generatePersonaId,
  streamId as generateStreamId,
  attachmentId as generateAttachmentId,
  extractionId as generateExtractionId,
} from "../../../src/lib/id"

/** The production Ariadne system persona ID */
const ARIADNE_PERSONA_ID = "persona_system_ariadne"

/** Default vision model for eval (must support image input) */
const VISION_MODEL_ID = "openrouter:anthropic/claude-sonnet-4.5"

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
 * Create a mock storage provider that returns images from a map.
 * Used for eval to avoid needing real S3/MinIO.
 */
function createMockStorage(images: Map<string, Buffer>): StorageProvider {
  return {
    async getSignedDownloadUrl(key: string): Promise<string> {
      return `mock://storage/${key}`
    },
    async getObject(key: string): Promise<Buffer> {
      const buffer = images.get(key)
      if (!buffer) {
        throw new Error(`Mock storage: key not found: ${key}`)
      }
      return buffer
    },
    async delete(): Promise<void> {
      // No-op for mock
    },
  }
}

/**
 * Set up test data for a multimodal vision eval case.
 * Creates persona, stream, trigger message with image attachment, and populates mock storage.
 */
async function setupTestData(
  input: MultimodalVisionInput,
  ctx: EvalContext,
  mockImages: Map<string, Buffer>
): Promise<{
  personaId: string
  streamId: string
  messageId: string
}> {
  const pool = ctx.pool
  const modelConfig = getModelConfig(ctx)

  // Read the production Ariadne persona to get its system prompt (INV-44)
  const productionPersona = await PersonaRepository.findById(pool, ARIADNE_PERSONA_ID)
  if (!productionPersona) {
    throw new Error(`Production persona ${ARIADNE_PERSONA_ID} not found - ensure migrations have run`)
  }
  if (!productionPersona.systemPrompt) {
    throw new Error(`Production persona ${ARIADNE_PERSONA_ID} has no system prompt`)
  }

  // Create a test persona that uses production Ariadne's config (system prompt, tools, etc.)
  // but with the eval's model. This is intentional: vision evals need vision-capable models,
  // which may differ from production. We copy production config to ensure the eval tests
  // realistic behavior, while model variation lets us test across different vision models.
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
      `eval-vision-${ulid().toLowerCase().slice(0, 8)}`,
      "Ariadne (Vision Eval)",
      productionPersona.description,
      productionPersona.avatarEmoji,
      productionPersona.systemPrompt,
      modelConfig.model,
      productionPersona.enabledTools ?? ["send_message"],
    ]
  )

  // Create a scratchpad stream (simplest context for vision testing)
  const testStreamId = generateStreamId()
  await StreamRepository.insert(pool, {
    id: testStreamId,
    workspaceId: ctx.workspaceId,
    type: StreamTypes.SCRATCHPAD,
    displayName: `Vision Eval ${ulid().toLowerCase().slice(0, 8)}`,
    visibility: "private",
    companionMode: "on",
    companionPersonaId: testPersonaId,
    createdBy: ctx.userId,
  })

  // Add user as stream member
  await StreamMemberRepository.insert(pool, testStreamId, ctx.userId)

  // Create event service for message creation
  const eventService = new EventService(pool)

  // Create the trigger message
  const triggerMessage = await eventService.createMessage({
    workspaceId: ctx.workspaceId,
    streamId: testStreamId,
    authorId: ctx.userId,
    authorType: AuthorTypes.MEMBER,
    contentJson: parseMarkdown(input.message),
    contentMarkdown: input.message,
  })

  // Create attachment record for the image
  const testAttachmentId = generateAttachmentId()
  const storagePath = `eval/${testAttachmentId}/${input.imageFilename}`

  // Decode base64 and store in mock storage
  const imageBuffer = Buffer.from(input.imageBase64, "base64")
  mockImages.set(storagePath, imageBuffer)

  // Insert attachment record
  await AttachmentRepository.insert(pool, {
    id: testAttachmentId,
    workspaceId: ctx.workspaceId,
    streamId: testStreamId,
    uploadedBy: ctx.userId,
    filename: input.imageFilename,
    mimeType: input.imageMimeType,
    sizeBytes: imageBuffer.length,
    storagePath,
    storageProvider: "s3",
  })

  // Attach to message
  await AttachmentRepository.attachToMessage(pool, [testAttachmentId], triggerMessage.id, testStreamId)

  // Mark as processed (so it's ready for agent)
  await AttachmentRepository.updateProcessingStatus(pool, testAttachmentId, ProcessingStatuses.COMPLETED)

  // Create an extraction record with image caption (simulating what the image processing pipeline would create)
  await AttachmentExtractionRepository.insert(pool, {
    id: generateExtractionId(),
    attachmentId: testAttachmentId,
    workspaceId: ctx.workspaceId,
    contentType: ExtractionContentTypes.PHOTO,
    summary: input.imageDescription,
    fullText: null,
  })

  return {
    personaId: testPersonaId,
    streamId: testStreamId,
    messageId: triggerMessage.id,
  }
}

/**
 * Task function that runs the persona agent using production code paths.
 *
 * Uses PersonaAgent.run() directly - the same code path as production (INV-45).
 * No duplicated prompts, no manual graph creation.
 */
async function runVisionTask(input: MultimodalVisionInput, ctx: EvalContext): Promise<MultimodalVisionOutput> {
  if (!input.message.trim()) {
    return {
      input,
      messages: [],
      responded: false,
      error: "Empty message",
    }
  }

  // Mock storage for this case's images
  const mockImages = new Map<string, Buffer>()

  try {
    // Set up test data in the database
    const { personaId, streamId, messageId } = await setupTestData(input, ctx, mockImages)

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
      costRecorder: undefined,
    })

    // Mock storage provider that returns our test images
    const mockStorage = createMockStorage(mockImages)

    // Model registry for vision capability checks
    const modelRegistry = createModelRegistry()

    // Stub Socket.io server for tracing
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

    // Create PersonaAgent with real dependencies including vision support
    const personaAgent = new PersonaAgent({
      pool: ctx.pool,
      traceEmitter,
      responseGenerator,
      userPreferencesService,
      researcher,
      searchService,
      storage: mockStorage,
      modelRegistry,
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
      trigger: undefined, // Companion mode
    }

    // Run the agent!
    await personaAgent.run(agentInput)

    // Read back messages sent by the agent
    const allMessages = await MessageRepository.list(ctx.pool, streamId, { limit: 100 })
    const agentMessages = allMessages.filter((m) => m.authorId === personaId)

    const messages: VisionMessage[] = agentMessages.map((m) => ({
      content: m.contentMarkdown,
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
 * Multimodal Vision Evaluation Suite
 */
export const multimodalVisionSuite: EvalSuite<MultimodalVisionInput, MultimodalVisionOutput, MultimodalVisionExpected> =
  {
    name: "multimodal-vision",
    description: "Evaluates agent ability to see and understand images with vision-capable models",

    cases: multimodalVisionCases,

    task: runVisionTask,

    evaluators: [
      respondedEvaluator,
      contentMentionsEvaluator,
      noHallucinationEvaluator,
      createImageUnderstandingEvaluator(),
    ],

    runEvaluators: [visionAccuracyEvaluator, averageUnderstandingEvaluator, hallucinationRateEvaluator],

    defaultPermutations: [
      {
        model: VISION_MODEL_ID,
        temperature: COMPANION_TEMPERATURE,
      },
    ],
  }

export default multimodalVisionSuite
