import type { Pool } from "pg"
import { withClient } from "../../db"
import { AgentTriggers, AuthorTypes, StreamTypes, type AuthorType, type SourceItem } from "@threa/types"
import type { UserPreferencesService } from "../user-preferences"
import { StreamRepository } from "../streams"
import { MessageRepository } from "../messaging"
import { MemberRepository } from "../workspaces"
import { PersonaRepository } from "./persona-repository"
import { AgentSessionRepository } from "./session-repository"
import { StreamEventRepository } from "../streams"
import { StreamMemberRepository } from "../streams"
import { AttachmentRepository } from "../attachments"
import { AttachmentExtractionRepository } from "../attachments"
import { PdfPageExtractionRepository } from "../attachments"
import type { TraceEmitter } from "./trace-emitter"
import type { AI } from "../../lib/ai/ai"
import type { SearchService } from "../search"
import { SearchRepository } from "../search"
import type { ConversationSummaryService } from "./conversation-summary-service"
import type { StorageProvider } from "../../lib/storage/s3-client"
import type { ModelRegistry } from "../../lib/ai/model-registry"
import {
  WorkspaceAgent,
  type WorkspaceAgentResult,
  computeAgentAccessSpec,
  enrichMessageSearchResults,
} from "./researcher"
import { resolveStreamIdentifier } from "./tools/identifier-resolver"
import { awaitAttachmentProcessing } from "../attachments"
import { logger } from "../../lib/logger"
import { buildAgentContext, buildToolSet, withCompanionSession, type WithSessionResult } from "./companion"
import { AgentRuntime, SessionTraceObserver, OtelObserver } from "./runtime"
import type {
  SearchToolsCallbacks,
  SearchAttachmentsCallbacks,
  GetAttachmentCallbacks,
  LoadAttachmentCallbacks,
  LoadPdfSectionCallbacks,
  LoadFileSectionCallbacks,
  LoadExcelSectionCallbacks,
  AttachmentSearchResult,
  AttachmentDetails,
  LoadAttachmentResult,
  LoadPdfSectionResult,
  LoadFileSectionResult,
  LoadExcelSectionResult,
} from "./tools"

export type { WithSessionResult }

export interface PersonaAgentDeps {
  pool: Pool
  ai: AI
  traceEmitter: TraceEmitter
  userPreferencesService: UserPreferencesService
  workspaceAgent: WorkspaceAgent
  searchService: SearchService
  conversationSummaryService: ConversationSummaryService
  storage: StorageProvider
  modelRegistry: ModelRegistry
  tavilyApiKey?: string
  stubResponse?: string
  createMessage: (params: {
    workspaceId: string
    streamId: string
    authorId: string
    authorType: AuthorType
    content: string
    sources?: SourceItem[]
    sessionId?: string
  }) => Promise<{ id: string }>
  createThread: (params: {
    workspaceId: string
    parentStreamId: string
    parentMessageId: string
    createdBy: string
  }) => Promise<{ id: string }>
}

export interface PersonaAgentInput {
  workspaceId: string
  streamId: string
  messageId: string
  personaId: string
  serverId: string
  trigger?: typeof AgentTriggers.MENTION
}

export interface PersonaAgentResult {
  sessionId: string | null
  messagesSent: number
  sentMessageIds: string[]
  status: "completed" | "failed" | "skipped"
  skipReason?: string
  lastSeenSequence?: bigint
  streamId?: string
  personaId?: string
}

export class PersonaAgent {
  constructor(private readonly deps: PersonaAgentDeps) {}

  async run(input: PersonaAgentInput): Promise<PersonaAgentResult> {
    const {
      pool,
      ai,
      traceEmitter,
      userPreferencesService,
      workspaceAgent,
      searchService,
      conversationSummaryService,
      storage,
      modelRegistry,
      tavilyApiKey,
      stubResponse,
      createMessage,
      createThread,
    } = this.deps
    const { workspaceId, streamId, messageId, personaId, serverId, trigger } = input

    // Step 1: Load and validate persona + stream
    const precheck = await withClient(pool, async (client) => {
      const persona = await PersonaRepository.findById(client, personaId)
      if (!persona || persona.status !== "active") {
        return { skip: true as const, reason: "persona not found or inactive" }
      }

      const stream = await StreamRepository.findById(client, streamId)
      if (!stream) {
        return { skip: true as const, reason: "stream not found" }
      }

      const latestSequence = await StreamEventRepository.getLatestSequence(client, streamId)

      return {
        skip: false as const,
        persona,
        stream,
        initialSequence: latestSequence ?? BigInt(0),
      }
    })

    if (precheck.skip) {
      return {
        sessionId: null,
        messagesSent: 0,
        sentMessageIds: [],
        status: "skipped",
        skipReason: precheck.reason,
      }
    }

    const { persona, stream, initialSequence } = precheck

    // Step 2: For channel mentions, create thread eagerly so session events go there
    const isChannelMention = trigger === AgentTriggers.MENTION && stream.type === StreamTypes.CHANNEL
    let sessionStreamId = streamId
    let channelStreamId: string | undefined
    if (isChannelMention) {
      const thread = await createThread({
        workspaceId,
        parentStreamId: streamId,
        parentMessageId: messageId,
        createdBy: persona.id,
      })
      sessionStreamId = thread.id
      channelStreamId = streamId
      logger.info({ threadId: thread.id, streamId, messageId }, "Created thread for channel mention (eager)")
    }

    // Step 3: Run with session lifecycle
    const result = await withCompanionSession(
      {
        pool,
        triggerMessageId: messageId,
        streamId: sessionStreamId,
        personaId: persona.id,
        personaName: persona.name,
        workspaceId,
        serverId,
        initialSequence: isChannelMention ? BigInt(0) : initialSequence,
      },
      async (session, db) => {
        const trace = traceEmitter.forSession({
          sessionId: session.id,
          workspaceId,
          streamId: sessionStreamId,
          triggerMessageId: messageId,
          personaName: persona.name,
          channelStreamId,
        })
        trace.notifyActivityStarted()

        // Build all context the agent needs
        const agentContext = await buildAgentContext(
          { db: pool, userPreferencesService, conversationSummaryService },
          { workspaceId, streamId, stream, messageId, persona, trigger }
        )

        // Record initial context step for trace UI
        if (agentContext.streamContext.conversationHistory.length > 0) {
          const history = agentContext.streamContext.conversationHistory
          const triggerIdx = history.findIndex((m) => m.id === messageId)
          const contextMessages = triggerIdx >= 0 ? history.slice(Math.max(0, triggerIdx - 4)) : history.slice(-5)

          const step = await trace.startStep({
            stepType: "context_received",
            content: JSON.stringify({
              messages: contextMessages.map((m) => ({
                messageId: m.id,
                authorName: agentContext.authorNames.get(m.authorId) ?? "Unknown",
                authorType: m.authorType,
                createdAt: m.createdAt.toISOString(),
                content: m.contentMarkdown.slice(0, 300),
                isTrigger: m.id === messageId,
              })),
            }),
          })
          await step.complete({})
        }

        // Build workspace agent callback for on-demand workspace research
        let runWorkspaceAgent: ((query: string) => Promise<WorkspaceAgentResult>) | undefined
        if (agentContext.triggerMessage && agentContext.invokingMemberId) {
          const capturedInvokingMemberId = agentContext.invokingMemberId
          runWorkspaceAgent = (query: string) =>
            workspaceAgent.search({
              workspaceId,
              streamId,
              query,
              conversationHistory: agentContext.streamContext.conversationHistory,
              invokingMemberId: capturedInvokingMemberId,
              dmParticipantIds: agentContext.dmParticipantIds,
            })
        }

        const targetStreamId = sessionStreamId

        const doSendMessage = async (msgInput: { content: string; sources?: SourceItem[] }) => {
          const message = await createMessage({
            workspaceId,
            streamId: targetStreamId,
            authorId: persona.id,
            authorType: AuthorTypes.PERSONA,
            content: msgInput.content,
            sources: msgInput.sources,
            sessionId: session.id,
          })
          return { messageId: message.id }
        }

        // Build search and attachment callbacks for tools
        const { searchCallbacks, attachmentCallbacks } = await this.buildToolCallbacks(db, {
          workspaceId,
          stream,
          streamId,
          invokingMemberId: agentContext.invokingMemberId,
          persona,
          searchService,
          storage,
          modelRegistry,
        })

        // Build tool set
        const tools = buildToolSet({
          enabledTools: persona.enabledTools,
          tavilyApiKey,
          runWorkspaceAgent,
          search: searchCallbacks,
          attachments: attachmentCallbacks,
        })

        // Stub mode: send canned response, skip AI loop
        if (stubResponse) {
          const msg = await doSendMessage({ content: stubResponse })
          return {
            messagesSent: 1,
            sentMessageIds: [msg.messageId],
            lastSeenSequence: session.lastSeenSequence ?? initialSequence,
          }
        }

        // Get model
        const model = ai.getLanguageModel(persona.model)
        const parsed = ai.parseModel(persona.model)

        // Run agent runtime
        const runtime = new AgentRuntime({
          ai,
          model,
          systemPrompt: agentContext.systemPrompt,
          messages: agentContext.messages,
          tools,
          sendMessage: doSendMessage,
          telemetry: {
            functionId: "agent-loop",
            metadata: {
              model_id: parsed.modelId,
              model_provider: parsed.modelProvider,
              model_name: parsed.modelName,
            },
          },
          observers: [
            new SessionTraceObserver(trace),
            new OtelObserver({
              sessionId: session.id,
              streamId: targetStreamId,
              personaId: persona.id,
              metadata: {
                model_id: parsed.modelId,
                model_provider: parsed.modelProvider,
                model_name: parsed.modelName,
              },
            }),
          ],
          newMessages: {
            check: async (checkStreamId, sinceSequence, excludeAuthorId) => {
              const messages = await MessageRepository.listSince(db, checkStreamId, sinceSequence, {
                excludeAuthorId,
              })

              const memberIds = [...new Set(messages.filter((m) => m.authorType === "member").map((m) => m.authorId))]
              const personaIds = [...new Set(messages.filter((m) => m.authorType === "persona").map((m) => m.authorId))]

              const [members, personas] = await Promise.all([
                memberIds.length > 0 ? MemberRepository.findByIds(db, memberIds) : Promise.resolve([]),
                personaIds.length > 0 ? PersonaRepository.findByIds(db, personaIds) : Promise.resolve([]),
              ])

              const names = new Map<string, string>()
              for (const m of members) names.set(m.id, m.name)
              for (const p of personas) names.set(p.id, p.name)

              return messages.map((m) => ({
                sequence: m.sequence,
                messageId: m.id,
                content: m.contentMarkdown,
                authorId: m.authorId,
                authorName: names.get(m.authorId) ?? "Unknown",
                authorType: m.authorType,
                createdAt: m.createdAt.toISOString(),
              }))
            },
            updateSequence: async (updateSessionId, sequence) => {
              await AgentSessionRepository.updateLastSeenSequence(db, updateSessionId, sequence)
            },
            awaitAttachments: async (messageIds) => {
              const attachmentsByMessage = await AttachmentRepository.findByMessageIds(db, messageIds)
              const allAttachmentIds: string[] = []
              for (const attachments of attachmentsByMessage.values()) {
                for (const a of attachments) allAttachmentIds.push(a.id)
              }
              if (allAttachmentIds.length > 0) {
                await awaitAttachmentProcessing(db, allAttachmentIds)
              }
            },
            streamId: targetStreamId,
            sessionId: session.id,
            personaId: persona.id,
            lastProcessedSequence: session.lastSeenSequence ?? initialSequence,
          },
        })

        const loopResult = await runtime.run()

        return {
          messagesSent: loopResult.messagesSent,
          sentMessageIds: loopResult.sentMessageIds,
          lastSeenSequence: loopResult.lastProcessedSequence,
        }
      }
    )

    // Notify trace rooms about terminal status
    if (result.status === "completed" || result.status === "failed") {
      const trace = traceEmitter.forSession({
        sessionId: result.sessionId,
        workspaceId,
        streamId: sessionStreamId,
        triggerMessageId: messageId,
        personaName: persona.name,
        channelStreamId,
      })
      if (result.status === "completed") {
        trace.notifyCompleted()
      } else {
        trace.notifyFailed()
      }
      trace.notifyActivityEnded()
    }

    switch (result.status) {
      case "skipped":
        return {
          sessionId: null,
          messagesSent: 0,
          sentMessageIds: [],
          status: "skipped",
          skipReason: result.reason,
        }

      case "failed":
        return {
          sessionId: result.sessionId,
          messagesSent: 0,
          sentMessageIds: [],
          status: "failed",
        }

      case "completed":
        return {
          sessionId: result.sessionId,
          messagesSent: result.messagesSent,
          sentMessageIds: result.sentMessageIds,
          status: "completed",
          lastSeenSequence: result.lastSeenSequence,
          streamId,
          personaId,
        }
    }
  }

  private async buildToolCallbacks(
    db: Pool,
    params: {
      workspaceId: string
      stream: Awaited<ReturnType<typeof StreamRepository.findById>> & {}
      streamId: string
      invokingMemberId: string | undefined
      persona: Awaited<ReturnType<typeof PersonaRepository.findById>> & {}
      searchService: SearchService
      storage: StorageProvider
      modelRegistry: ModelRegistry
    }
  ): Promise<{
    searchCallbacks: SearchToolsCallbacks | undefined
    attachmentCallbacks:
      | {
          search: SearchAttachmentsCallbacks
          get: GetAttachmentCallbacks
          load?: LoadAttachmentCallbacks
          loadPdfSection?: LoadPdfSectionCallbacks
          loadFileSection?: LoadFileSectionCallbacks
          loadExcelSection?: LoadExcelSectionCallbacks
        }
      | undefined
  }> {
    const { workspaceId, stream, streamId, invokingMemberId, persona, searchService, storage, modelRegistry } = params

    if (!invokingMemberId) {
      return { searchCallbacks: undefined, attachmentCallbacks: undefined }
    }

    const accessSpec = await computeAgentAccessSpec(db, { stream, invokingMemberId })
    const accessibleStreamIds = await SearchRepository.getAccessibleStreamsForAgent(db, accessSpec, workspaceId)

    const searchCallbacks: SearchToolsCallbacks = {
      searchMessages: async (input) => {
        let filterStreamIds = accessibleStreamIds
        if (input.stream) {
          const resolved = await resolveStreamIdentifier(db, workspaceId, input.stream, accessibleStreamIds)
          if (!resolved.resolved) return []
          filterStreamIds = [resolved.id]
        }

        const results = await searchService.search({
          workspaceId,
          memberId: invokingMemberId,
          query: input.query,
          filters: { streamIds: filterStreamIds },
          limit: 10,
          exact: input.exact,
        })

        const enriched = await enrichMessageSearchResults(db, results)
        return enriched.map((r) => ({
          id: r.id,
          content: r.content,
          authorName: r.authorName,
          streamName: r.streamName,
          createdAt: r.createdAt.toISOString(),
        }))
      },

      searchStreams: async (input) => {
        const streams = await StreamRepository.searchByName(db, {
          streamIds: accessibleStreamIds,
          query: input.query,
          types: input.types,
          limit: 10,
        })
        return streams.map((s) => ({
          id: s.id,
          type: s.type,
          name: s.displayName ?? s.slug ?? null,
          description: s.description ?? null,
        }))
      },

      searchUsers: async (input) => {
        const members = await MemberRepository.searchByNameOrSlug(db, workspaceId, input.query, 10)
        return members.map((m) => ({ id: m.id, name: m.name, email: m.email }))
      },

      getStreamMessages: async (input) => {
        const resolved = await resolveStreamIdentifier(db, workspaceId, input.stream, accessibleStreamIds)
        if (!resolved.resolved) return []

        const messages = await MessageRepository.list(db, resolved.id, { limit: input.limit ?? 10 })
        messages.reverse()

        const memberIds = [...new Set(messages.filter((m) => m.authorType === "member").map((m) => m.authorId))]
        const personaIds = [...new Set(messages.filter((m) => m.authorType === "persona").map((m) => m.authorId))]
        const [members, personas] = await Promise.all([
          memberIds.length > 0 ? MemberRepository.findByIds(db, memberIds) : Promise.resolve([]),
          personaIds.length > 0 ? PersonaRepository.findByIds(db, personaIds) : Promise.resolve([]),
        ])

        const memberMap = new Map(members.map((m) => [m.id, m.name]))
        const personaMap = new Map(personas.map((p) => [p.id, p.name]))

        return messages.map((m) => ({
          id: m.id,
          content: m.contentMarkdown,
          authorName:
            m.authorType === "member"
              ? (memberMap.get(m.authorId) ?? "Unknown Member")
              : (personaMap.get(m.authorId) ?? "Unknown Persona"),
          authorType: m.authorType,
          createdAt: m.createdAt.toISOString(),
        }))
      },
    }

    const searchAttachments: SearchAttachmentsCallbacks = {
      searchAttachments: async (input): Promise<AttachmentSearchResult[]> => {
        const results = await AttachmentRepository.searchWithExtractions(db, {
          workspaceId,
          streamIds: accessibleStreamIds,
          query: input.query,
          contentTypes: input.contentTypes as import("@threa/types").ExtractionContentType[] | undefined,
          limit: input.limit,
        })
        return results.map((r) => ({
          id: r.id,
          filename: r.filename,
          mimeType: r.mimeType,
          contentType: r.extraction?.contentType ?? null,
          summary: r.extraction?.summary ?? null,
          streamId: r.streamId,
          messageId: r.messageId,
          createdAt: r.createdAt.toISOString(),
        }))
      },
    }

    const getAttachment: GetAttachmentCallbacks = {
      getAttachment: async (input): Promise<AttachmentDetails | null> => {
        const attachment = await AttachmentRepository.findById(db, input.attachmentId)
        if (!attachment) return null
        if (!attachment.streamId || !accessibleStreamIds.includes(attachment.streamId)) return null

        const extraction = await AttachmentExtractionRepository.findByAttachmentId(db, input.attachmentId)
        return {
          id: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          processingStatus: attachment.processingStatus,
          createdAt: attachment.createdAt.toISOString(),
          extraction: extraction
            ? {
                contentType: extraction.contentType,
                summary: extraction.summary,
                fullText: extraction.fullText,
                structuredData: extraction.structuredData,
              }
            : null,
        }
      },
    }

    let loadAttachment: LoadAttachmentCallbacks | undefined
    if (modelRegistry.supportsVision(persona.model)) {
      loadAttachment = {
        loadAttachment: async (input): Promise<LoadAttachmentResult | null> => {
          const attachment = await AttachmentRepository.findById(db, input.attachmentId)
          if (!attachment) return null
          if (!attachment.streamId || !accessibleStreamIds.includes(attachment.streamId)) return null
          if (!attachment.mimeType.startsWith("image/")) return null

          const buffer = await storage.getObject(attachment.storagePath)
          const base64 = buffer.toString("base64")
          return {
            id: attachment.id,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            dataUrl: `data:${attachment.mimeType};base64,${base64}`,
          }
        },
      }
    }

    const loadPdfSection: LoadPdfSectionCallbacks = {
      loadPdfSection: async (input): Promise<LoadPdfSectionResult | null> => {
        const attachment = await AttachmentRepository.findById(db, input.attachmentId)
        if (!attachment) return null
        if (!attachment.streamId || !accessibleStreamIds.includes(attachment.streamId)) return null

        const extraction = await AttachmentExtractionRepository.findByAttachmentId(db, input.attachmentId)
        if (!extraction || extraction.sourceType !== "pdf" || !extraction.pdfMetadata) return null

        const totalPages = extraction.pdfMetadata.totalPages
        if (input.startPage > totalPages || input.endPage > totalPages) return null

        const pages = await PdfPageExtractionRepository.findByAttachmentAndPageRange(
          db,
          input.attachmentId,
          input.startPage,
          input.endPage
        )

        const pageContents = pages.map((p) => ({
          pageNumber: p.pageNumber,
          content: p.markdownContent ?? p.ocrText ?? p.rawText ?? "",
        }))

        return {
          attachmentId: input.attachmentId,
          filename: attachment.filename,
          startPage: input.startPage,
          endPage: input.endPage,
          totalPages,
          content: pageContents.map((p) => p.content).join("\n\n---\n\n"),
          pages: pageContents,
        }
      },
    }

    const loadFileSection: LoadFileSectionCallbacks = {
      loadFileSection: async (input): Promise<LoadFileSectionResult | null> => {
        const attachment = await AttachmentRepository.findById(db, input.attachmentId)
        if (!attachment) return null
        if (!attachment.streamId || !accessibleStreamIds.includes(attachment.streamId)) return null

        const extraction = await AttachmentExtractionRepository.findByAttachmentId(db, input.attachmentId)
        if (!extraction || extraction.sourceType !== "text" || !extraction.textMetadata) return null

        const totalLines = extraction.textMetadata.totalLines
        if (input.startLine >= totalLines || input.endLine > totalLines) return null

        const fileBuffer = await storage.getObject(attachment.storagePath)
        const lines = fileBuffer.toString("utf-8").split("\n")

        return {
          attachmentId: input.attachmentId,
          filename: attachment.filename,
          startLine: input.startLine,
          endLine: input.endLine,
          totalLines,
          content: lines.slice(input.startLine, input.endLine).join("\n"),
        }
      },
    }

    const loadExcelSection: LoadExcelSectionCallbacks = {
      loadExcelSection: async (input): Promise<LoadExcelSectionResult | null> => {
        const attachment = await AttachmentRepository.findById(db, input.attachmentId)
        if (!attachment) return null
        if (!attachment.streamId || !accessibleStreamIds.includes(attachment.streamId)) return null

        const extraction = await AttachmentExtractionRepository.findByAttachmentId(db, input.attachmentId)
        if (!extraction || extraction.sourceType !== "excel" || !extraction.excelMetadata) return null

        const sheetInfo = extraction.excelMetadata.sheets.find((s) => s.name === input.sheetName)
        if (!sheetInfo) return null

        const { EXCEL_MAX_ROWS_PER_REQUEST } = await import("../attachments/excel/config")
        const startRow = input.startRow ?? 0
        const endRow = Math.min(input.endRow ?? sheetInfo.rows, startRow + EXCEL_MAX_ROWS_PER_REQUEST)
        if (startRow >= sheetInfo.rows || endRow > sheetInfo.rows) return null

        const { extractExcel } = await import("../attachments/excel/extractor")
        const { validateExcelFormat } = await import("../attachments/excel/detector")
        const fileBuffer = await storage.getObject(attachment.storagePath)
        const format = validateExcelFormat(fileBuffer)
        const extracted = extractExcel(fileBuffer, format)

        const sheet = extracted.sheets.find((s) => s.name === input.sheetName)
        if (!sheet) return null

        const selectedRows = sheet.data.slice(startRow, endRow)
        const headerRow = `| ${sheet.headers.join(" | ")} |`
        const separator = `| ${sheet.headers.map(() => "---").join(" | ")} |`
        const dataRows = selectedRows.map((row) => `| ${row.join(" | ")} |`).join("\n")

        return {
          attachmentId: input.attachmentId,
          filename: attachment.filename,
          sheetName: input.sheetName,
          startRow,
          endRow,
          totalRows: sheet.rows,
          headers: sheet.headers,
          content: `${headerRow}\n${separator}\n${dataRows}`,
        }
      },
    }

    return {
      searchCallbacks,
      attachmentCallbacks: {
        search: searchAttachments,
        get: getAttachment,
        load: loadAttachment,
        loadPdfSection,
        loadFileSection,
        loadExcelSection,
      },
    }
  }
}
