import crypto from "crypto"
import type { Pool } from "pg"
import { z } from "zod"
import type { SourceItem } from "@threa/types"
import { isAbortError, type AI, type CostContext } from "../../../lib/ai/ai"
import type { StorageProvider } from "../../../lib/storage/s3-client"
import type { WorkspaceAgent, WorkspaceAgentResult } from "../researcher"
import type { GitHubToolDeps, RunWorkspaceAgentOptions } from "../tools"
import { createGithubListReposTool, createGithubSearchIssuesTool, createWebSearchTool } from "../tools"
import type { AgentToolResult } from "../runtime"
import { logger } from "../../../lib/logger"
import {
  GENERAL_RESEARCH_LEAD_MODEL_ID,
  GENERAL_RESEARCH_RESEARCHER_MODEL_ID,
  GENERAL_RESEARCH_WRITER_MODEL_ID,
  GENERAL_RESEARCH_REFERENCE_MODEL_ID,
  GENERAL_RESEARCH_SYSTEM_PROMPT,
  GENERAL_RESEARCH_REFERENCE_SYSTEM_PROMPT,
  GENERAL_RESEARCH_TEMPERATURE,
  GENERAL_RESEARCH_WRITER_TEMPERATURE,
  GENERAL_RESEARCH_PHASE_TIMEOUT_MS,
  GENERAL_RESEARCH_LEASE_MS,
  GENERAL_RESEARCH_MAX_TOPICS,
  GENERAL_RESEARCH_MAX_FINDINGS_PER_TOPIC,
  GENERAL_RESEARCH_MAX_SOURCES,
  GENERAL_RESEARCH_MAX_REPORT_CHARS,
  GENERAL_RESEARCH_MAX_ANSWER_CHARS,
} from "./config"
import {
  GeneralResearchRepository,
  GeneralResearchRunStatuses,
  type GeneralResearchRun,
  type GeneralResearchRunStatus,
} from "./repository"

const ResearchPlanSchema = z.object({
  clarificationQuestion: z.string().nullable(),
  effort: z.enum(["quick", "standard", "thorough"]),
  reasoning: z.string(),
  topics: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        title: z.string().min(1).max(120),
        goal: z.string().min(1).max(600),
        surfaces: z.array(z.enum(["workspace", "web", "github"])).min(1),
      })
    )
    .max(GENERAL_RESEARCH_MAX_TOPICS),
  expectedOutput: z.string().min(1).max(400),
})

const ReconsiderPlanSchema = z.object({
  changed: z.boolean(),
  reasoning: z.string(),
  plan: ResearchPlanSchema,
})

const TopicSynthesisSchema = z.object({
  summary: z.string(),
  findings: z.array(z.string()).max(GENERAL_RESEARCH_MAX_FINDINGS_PER_TOPIC),
  clarificationRequest: z.string().nullable(),
})

const ReportSchema = z.object({
  answer: z.string().max(GENERAL_RESEARCH_MAX_ANSWER_CHARS),
  reportMarkdown: z.string().max(GENERAL_RESEARCH_MAX_REPORT_CHARS),
})

const ReferenceSchema = z.object({
  answer: z.string().max(GENERAL_RESEARCH_MAX_ANSWER_CHARS),
  reportMarkdown: z.string().max(GENERAL_RESEARCH_MAX_REPORT_CHARS),
})

const GeneralResearchResultSchema: z.ZodType<GeneralResearchResult> = z.object({
  status: z.enum(["ok", "needs_clarification", "partial"]),
  answer: z.string(),
  reportStorageKey: z.string().optional(),
  sources: z.array(z.custom<SourceItem>()),
  substeps: z.array(z.object({ text: z.string(), at: z.string() })),
  effort: z.enum(["quick", "standard", "thorough"]).optional(),
  topicsCompleted: z.number(),
  topicsPlanned: z.number(),
  surfacesUsed: z.array(z.string()),
  partialReason: z.enum(["user_abort", "timeout"]).optional(),
  clarificationQuestion: z.string().optional(),
})

const S3ReportSchema = z.object({ key: z.string() })

type ResearchPlan = z.infer<typeof ResearchPlanSchema>
type TopicPlan = ResearchPlan["topics"][number]
type TopicSynthesis = z.infer<typeof TopicSynthesisSchema>

export interface GeneralResearchSubstep {
  text: string
  at: string
}

export interface GeneralResearchResult {
  status: "ok" | "needs_clarification" | "partial"
  answer: string
  reportStorageKey?: string
  sources: SourceItem[]
  substeps: GeneralResearchSubstep[]
  effort?: ResearchPlan["effort"]
  topicsCompleted: number
  topicsPlanned: number
  surfacesUsed: string[]
  partialReason?: "user_abort" | "timeout"
  clarificationQuestion?: string
}

export interface GeneralResearchInput {
  workspaceId: string
  streamId: string
  sessionId: string
  toolCallId: string
  invocationKey: string
  query: string
  conversationSummary: string
  invokingUserId?: string
  signal?: AbortSignal
  deadlineAt?: number
  onSubstep?: (text: string) => void
  runWorkspaceAgent?: (query: string, opts: RunWorkspaceAgentOptions) => Promise<WorkspaceAgentResult>
  github?: GitHubToolDeps
  tavilyApiKey?: string
  costContext: CostContext
  checkForNewMessages?: (lastSeenSequence: bigint) => Promise<{
    messages: Array<{ sequence: bigint; content: string; authorName: string; changeType: string }>
    lastSeenSequence: bigint
  }>
  initialLastSeenSequence?: bigint
}

export interface GeneralResearcherDeps {
  pool: Pool
  ai: AI
  storage: StorageProvider
  workspaceAgent: WorkspaceAgent
  leaseOwner: string
}

interface ExecutionState {
  run: GeneralResearchRun
  substeps: GeneralResearchSubstep[]
  lastSeenSequence: bigint
}

function hashInput(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function isTerminal(run: GeneralResearchRun): boolean {
  return (
    run.status === GeneralResearchRunStatuses.COMPLETED ||
    run.status === GeneralResearchRunStatuses.PARTIAL ||
    run.status === GeneralResearchRunStatuses.NEEDS_CLARIFICATION ||
    run.status === GeneralResearchRunStatuses.FAILED
  )
}

function makeTimeoutSignal(signal: AbortSignal | undefined, deadlineAt: number | undefined): AbortSignal {
  const deadlineDelay = deadlineAt ? Math.max(0, deadlineAt - Date.now()) : GENERAL_RESEARCH_PHASE_TIMEOUT_MS
  const timeoutSignal = AbortSignal.timeout(Math.min(deadlineDelay, GENERAL_RESEARCH_PHASE_TIMEOUT_MS))
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}

function normalizeSources(sources: SourceItem[]): SourceItem[] {
  const seen = new Set<string>()
  const normalized: SourceItem[] = []
  for (const source of sources) {
    if (!source.title || !source.url) continue
    const key = `${source.type ?? "web"}|${source.url}|${source.title}`
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(source)
    if (normalized.length >= GENERAL_RESEARCH_MAX_SOURCES) break
  }
  return normalized
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export class GeneralResearcher {
  constructor(private readonly deps: GeneralResearcherDeps) {}

  async releaseLeases(): Promise<void> {
    await GeneralResearchRepository.releaseActiveLeasesForOwner(this.deps.pool, this.deps.leaseOwner)
  }

  async research(input: GeneralResearchInput): Promise<GeneralResearchResult> {
    const run = await GeneralResearchRepository.findOrCreateRun(this.deps.pool, {
      workspaceId: input.workspaceId,
      agentSessionId: input.sessionId,
      invocationKey: input.invocationKey,
      toolCallId: input.toolCallId,
      query: input.query,
      inputHash: hashInput({ query: input.query, conversationSummary: input.conversationSummary }),
      initialPhase: "lead_plan",
    })

    if (isTerminal(run) && run.outputJson) {
      if (run.status === GeneralResearchRunStatuses.FAILED) {
        throw new Error(`General research run ${run.id} is in failed state`)
      }
      return this.parseCheckpoint(GeneralResearchResultSchema, run.outputJson, {
        runId: run.id,
        stepKey: "run_output",
      })
    }

    const claimed = await GeneralResearchRepository.claimRun(this.deps.pool, {
      runId: run.id,
      leaseOwner: this.deps.leaseOwner,
      leaseExpiresAt: new Date(Date.now() + GENERAL_RESEARCH_LEASE_MS),
    })
    if (!claimed) {
      const reason =
        run.status === GeneralResearchRunStatuses.FAILED ? "is in failed state" : "is leased by another worker"
      throw new Error(`General research run ${run.id} ${reason}`)
    }

    const state: ExecutionState = {
      run: claimed,
      substeps: [],
      lastSeenSequence: input.initialLastSeenSequence ?? 0n,
    }

    try {
      const plan = await this.runCheckpointed(
        state,
        "lead_plan",
        "lead_plan",
        { query: input.query },
        ResearchPlanSchema,
        async () => {
          this.emit(state, input, "Planning research")
          return this.plan(input)
        }
      )

      if (plan.clarificationQuestion) {
        return this.complete(state, {
          status: "needs_clarification",
          answer: plan.clarificationQuestion,
          clarificationQuestion: plan.clarificationQuestion,
          sources: [],
          effort: plan.effort,
          topicsCompleted: 0,
          topicsPlanned: plan.topics.length,
          surfacesUsed: [],
        })
      }

      const reconsidered = await this.maybeReconsiderPlan(state, input, plan)
      const activePlan = reconsidered ?? plan

      const topicResults: Array<TopicSynthesis & { topic: TopicPlan; sources: SourceItem[]; rawContext: string }> = []
      const webSearchTool = input.tavilyApiKey ? createWebSearchTool({ tavilyApiKey: input.tavilyApiKey }) : null
      const githubTools = input.github
        ? {
            listRepos: createGithubListReposTool(input.github),
            searchIssues: createGithubSearchIssuesTool(input.github),
          }
        : null
      for (let i = 0; i < activePlan.topics.length && topicResults.length < GENERAL_RESEARCH_MAX_TOPICS; i++) {
        const topic = activePlan.topics[i]
        if (!topic) continue
        if (this.shouldStop(input)) return this.partial(state, input, activePlan, topicResults, "user_abort")
        const result = await this.runCheckpointed(
          state,
          `topic:${topic.id}`,
          "topic_research",
          { topic },
          TopicSynthesisSchema.extend({
            sources: z.array(z.custom<SourceItem>()),
            rawContext: z.string(),
          }),
          async () => this.researchTopic(state, input, topic, { webSearchTool, githubTools })
        )
        topicResults.push({ topic, ...result })

        const updatedPlan = await this.maybeReconsiderPlan(state, input, activePlan, topicResults)
        if (updatedPlan) activePlan.topics = updatedPlan.topics
      }

      const upwardClarification = topicResults.find((result) => result.clarificationRequest)
      if (upwardClarification?.clarificationRequest) {
        const question = upwardClarification.clarificationRequest
        return this.complete(state, {
          status: "needs_clarification",
          answer: question,
          clarificationQuestion: question,
          sources: normalizeSources(topicResults.flatMap((r) => r.sources)),
          effort: activePlan.effort,
          topicsCompleted: topicResults.length,
          topicsPlanned: activePlan.topics.length,
          surfacesUsed: [...new Set(activePlan.topics.flatMap((t) => t.surfaces))],
        })
      }

      const report = await this.runCheckpointed(
        state,
        "report_writer",
        "report_writer",
        { activePlan },
        ReportSchema,
        async () => {
          this.emit(state, input, "Writing concise research report")
          return this.writeReport(input, activePlan, topicResults)
        }
      )
      const referenced = await this.runCheckpointed(
        state,
        "reference_agent",
        "reference_agent",
        { report },
        ReferenceSchema,
        async () => {
          this.emit(state, input, "Checking references")
          return this.annotateReferences(input, report, normalizeSources(topicResults.flatMap((r) => r.sources)))
        }
      )

      const reportStorageKey = await this.runCheckpointed(
        state,
        "s3_report",
        "s3_report",
        { sessionId: input.sessionId },
        S3ReportSchema,
        async () => {
          this.emit(state, input, "Saving report")
          const key = `research-reports/${input.workspaceId}/${input.sessionId}/${run.id}.md`
          await this.deps.storage.putObject(key, Buffer.from(referenced.reportMarkdown, "utf8"), "text/markdown")
          return { key }
        }
      )

      return this.complete(state, {
        status: "ok",
        answer: referenced.answer,
        reportStorageKey: reportStorageKey.key,
        sources: normalizeSources(topicResults.flatMap((r) => r.sources)),
        effort: activePlan.effort,
        topicsCompleted: topicResults.length,
        topicsPlanned: activePlan.topics.length,
        surfacesUsed: [...new Set(activePlan.topics.flatMap((t) => t.surfaces))],
      })
    } catch (error) {
      if (this.shouldStop(input) || isAbortError(error)) {
        const planStep = await GeneralResearchRepository.findStep(this.deps.pool, run.id, "lead_plan")
        const plan = planStep?.outputJson
          ? this.parseCheckpoint(ResearchPlanSchema, planStep.outputJson, { runId: run.id, stepKey: "lead_plan" })
          : null
        return this.partial(state, input, plan ?? null, [], input.signal?.aborted ? "user_abort" : "timeout")
      }
      logger.error({ error, runId: run.id }, "General research failed")
      throw error
    }
  }

  private async runCheckpointed<T>(
    state: ExecutionState,
    stepKey: string,
    phase: string,
    inputJson: unknown,
    schema: z.ZodType<T>,
    fn: () => Promise<T>
  ): Promise<T> {
    const existing = await GeneralResearchRepository.findStep(this.deps.pool, state.run.id, stepKey)
    if (existing?.completedAt) {
      return this.parseCheckpoint(schema, existing.outputJson, { runId: state.run.id, stepKey })
    }

    const started = await GeneralResearchRepository.startStep(this.deps.pool, {
      workspaceId: state.run.workspaceId,
      runId: state.run.id,
      stepKey,
      phase,
      inputJson,
    })
    if (started.completedAt) {
      return this.parseCheckpoint(schema, started.outputJson, { runId: state.run.id, stepKey })
    }
    await GeneralResearchRepository.updateRunPhase(this.deps.pool, state.run.id, phase)
    await GeneralResearchRepository.renewRunLease(this.deps.pool, {
      runId: state.run.id,
      leaseOwner: this.deps.leaseOwner,
      leaseExpiresAt: new Date(Date.now() + GENERAL_RESEARCH_LEASE_MS),
    })

    try {
      const output = await fn()
      await GeneralResearchRepository.completeStep(this.deps.pool, {
        runId: state.run.id,
        stepKey,
        outputJson: output,
        sources: (output as { sources?: SourceItem[] })?.sources,
      })
      return output
    } catch (error) {
      await GeneralResearchRepository.failStep(this.deps.pool, {
        runId: state.run.id,
        stepKey,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  private async plan(input: GeneralResearchInput): Promise<ResearchPlan> {
    const { value } = await this.deps.ai.generateObject({
      model: GENERAL_RESEARCH_LEAD_MODEL_ID,
      schema: ResearchPlanSchema,
      temperature: GENERAL_RESEARCH_TEMPERATURE,
      abortSignal: makeTimeoutSignal(input.signal, input.deadlineAt),
      telemetry: { functionId: "general-research-plan", metadata: { session_id: input.sessionId } },
      context: input.costContext,
      messages: [
        { role: "system", content: GENERAL_RESEARCH_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Question:\n${input.query}\n\nConversation context:\n${input.conversationSummary || "None"}`,
        },
      ],
    })
    return { ...value, topics: value.topics.slice(0, GENERAL_RESEARCH_MAX_TOPICS) }
  }

  private async maybeReconsiderPlan(
    state: ExecutionState,
    input: GeneralResearchInput,
    plan: ResearchPlan,
    topicResults: Array<{ topic: TopicPlan; summary: string }> = []
  ): Promise<ResearchPlan | null> {
    if (!input.checkForNewMessages) return null
    const checked = await input.checkForNewMessages(state.lastSeenSequence)
    state.lastSeenSequence = checked.lastSeenSequence
    if (checked.messages.length === 0) return null

    const stepKey = `reconsider:${checked.lastSeenSequence.toString()}`
    return this.runCheckpointed(
      state,
      stepKey,
      "lead_reconsider",
      { messages: checked.messages },
      ResearchPlanSchema.nullable(),
      async () => {
        this.emit(state, input, "Reconsidering research plan after new context")
        const { value } = await this.deps.ai.generateObject({
          model: GENERAL_RESEARCH_LEAD_MODEL_ID,
          schema: ReconsiderPlanSchema,
          temperature: GENERAL_RESEARCH_TEMPERATURE,
          abortSignal: makeTimeoutSignal(input.signal, input.deadlineAt),
          telemetry: { functionId: "general-research-reconsider", metadata: { session_id: input.sessionId } },
          context: input.costContext,
          messages: [
            { role: "system", content: GENERAL_RESEARCH_SYSTEM_PROMPT },
            {
              role: "user",
              content: `Original question:\n${input.query}\n\nCurrent plan:\n${JSON.stringify(plan)}\n\nCompleted topic summaries:\n${JSON.stringify(topicResults)}\n\nNew or edited messages:\n${JSON.stringify(checked.messages)}\n\nUpdate the plan only if the new context changes the research goal.`,
            },
          ],
        })
        return value.changed ? value.plan : null
      }
    )
  }

  private async researchTopic(
    state: ExecutionState,
    input: GeneralResearchInput,
    topic: TopicPlan,
    tools: {
      webSearchTool: ReturnType<typeof createWebSearchTool> | null
      githubTools: {
        listRepos: ReturnType<typeof createGithubListReposTool>
        searchIssues: ReturnType<typeof createGithubSearchIssuesTool>
      } | null
    }
  ): Promise<TopicSynthesis & { sources: SourceItem[]; rawContext: string }> {
    this.emit(state, input, `Researching: ${topic.title}`)
    const contextBlocks: string[] = []
    const sources: SourceItem[] = []

    if (topic.surfaces.includes("workspace") && input.runWorkspaceAgent) {
      const result = await input.runWorkspaceAgent(`${topic.title}\n${topic.goal}`, {
        signal: input.signal ?? new AbortController().signal,
        deadlineAt: input.deadlineAt ?? Date.now() + GENERAL_RESEARCH_PHASE_TIMEOUT_MS,
        onSubstep: (text) => this.emit(state, input, text),
      })
      if (result.retrievedContext) contextBlocks.push(`Workspace findings:\n${result.retrievedContext}`)
      sources.push(
        ...result.sources.map((source) => ({
          type: "workspace" as const,
          title: source.title,
          url: source.url,
          snippet: source.snippet,
        }))
      )
    }

    if (topic.surfaces.includes("web") && tools.webSearchTool) {
      const result = await tools.webSearchTool.config.execute(
        { query: `${input.query} ${topic.title}` },
        { toolCallId: topic.id }
      )
      contextBlocks.push(`Web findings:\n${result.output}`)
      sources.push(...((result.sources ?? []) as SourceItem[]))
    }

    if (topic.surfaces.includes("github") && tools.githubTools) {
      const githubText = await this.readGithub(topic, tools.githubTools)
      if (githubText.output) contextBlocks.push(`GitHub findings:\n${githubText.output}`)
      sources.push(...githubText.sources)
    }

    const { value } = await this.deps.ai.generateObject({
      model: GENERAL_RESEARCH_RESEARCHER_MODEL_ID,
      schema: TopicSynthesisSchema,
      temperature: GENERAL_RESEARCH_TEMPERATURE,
      abortSignal: makeTimeoutSignal(input.signal, input.deadlineAt),
      telemetry: { functionId: "general-research-topic", metadata: { session_id: input.sessionId, topic: topic.id } },
      context: input.costContext,
      messages: [
        { role: "system", content: GENERAL_RESEARCH_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Question:\n${input.query}\n\nTopic:\n${topic.title}\n${topic.goal}\n\nContext gathered:\n${contextBlocks.join("\n\n") || "No context found."}\n\nSummarize findings. If this topic cannot be answered without clarification, set clarificationRequest.`,
        },
      ],
    })

    return { ...value, sources: normalizeSources(sources), rawContext: contextBlocks.join("\n\n") }
  }

  private async readGithub(
    topic: TopicPlan,
    github: {
      listRepos: ReturnType<typeof createGithubListReposTool>
      searchIssues: ReturnType<typeof createGithubSearchIssuesTool>
    }
  ): Promise<{ output: string; sources: SourceItem[] }> {
    const reposResult = await github.listRepos.config.execute({}, { toolCallId: `${topic.id}:repos` })
    const repos = safeJsonParse<{ repositories?: Array<{ fullName?: string }> }>(reposResult.output)
    const repoName = repos?.repositories?.find((repo) => repo.fullName)?.fullName
    if (!repoName) return { output: reposResult.output, sources: (reposResult.sources ?? []) as SourceItem[] }
    const [owner, repo] = repoName.split("/")
    if (!owner || !repo) return { output: reposResult.output, sources: (reposResult.sources ?? []) as SourceItem[] }

    const issuesResult = await github.searchIssues.config.execute(
      { owner, repo, query: topic.title, sort: "best-match", order: "desc", perPage: 10, page: 1 },
      { toolCallId: `${topic.id}:issues` }
    )
    return {
      output: `${reposResult.output}\n${issuesResult.output}`,
      sources: normalizeSources([...(reposResult.sources ?? []), ...(issuesResult.sources ?? [])] as SourceItem[]),
    }
  }

  private async writeReport(
    input: GeneralResearchInput,
    plan: ResearchPlan,
    topicResults: Array<TopicSynthesis & { topic: TopicPlan; rawContext: string }>
  ): Promise<z.infer<typeof ReportSchema>> {
    const { value } = await this.deps.ai.generateObject({
      model: GENERAL_RESEARCH_WRITER_MODEL_ID,
      schema: ReportSchema,
      temperature: GENERAL_RESEARCH_WRITER_TEMPERATURE,
      abortSignal: makeTimeoutSignal(input.signal, input.deadlineAt),
      telemetry: { functionId: "general-research-write-report", metadata: { session_id: input.sessionId } },
      context: input.costContext,
      messages: [
        { role: "system", content: GENERAL_RESEARCH_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Question:\n${input.query}\n\nPlan:\n${JSON.stringify(plan)}\n\nResearch results:\n${JSON.stringify(topicResults)}\n\nWrite a concise answer and a markdown report. Answer the question directly.`,
        },
      ],
    })
    return value
  }

  private async annotateReferences(
    input: GeneralResearchInput,
    report: z.infer<typeof ReportSchema>,
    sources: SourceItem[]
  ): Promise<z.infer<typeof ReferenceSchema>> {
    const { value } = await this.deps.ai.generateObject({
      model: GENERAL_RESEARCH_REFERENCE_MODEL_ID,
      schema: ReferenceSchema,
      temperature: GENERAL_RESEARCH_TEMPERATURE,
      abortSignal: makeTimeoutSignal(input.signal, input.deadlineAt),
      telemetry: { functionId: "general-research-reference", metadata: { session_id: input.sessionId } },
      context: input.costContext,
      messages: [
        {
          role: "system",
          content: GENERAL_RESEARCH_REFERENCE_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: `Sources:\n${JSON.stringify(sources)}\n\nAnswer/report:\n${JSON.stringify(report)}`,
        },
      ],
    })
    return value
  }

  private async complete(
    state: ExecutionState,
    result: Omit<GeneralResearchResult, "substeps"> & { status: GeneralResearchResult["status"] }
  ): Promise<GeneralResearchResult> {
    const fullResult: GeneralResearchResult = { ...result, substeps: state.substeps }
    let runStatus: GeneralResearchRunStatus = GeneralResearchRunStatuses.PARTIAL
    if (result.status === "ok") {
      runStatus = GeneralResearchRunStatuses.COMPLETED
    } else if (result.status === "needs_clarification") {
      runStatus = GeneralResearchRunStatuses.NEEDS_CLARIFICATION
    }
    const completed = await GeneralResearchRepository.completeRun(this.deps.pool, {
      runId: state.run.id,
      status: runStatus,
      finalAnswer: result.answer,
      partialReason: result.partialReason ?? null,
      reportStorageKey: result.reportStorageKey ?? null,
      outputJson: fullResult,
      sources: result.sources,
      leaseOwner: this.deps.leaseOwner,
    })
    if (!completed) {
      throw new Error(`General research run ${state.run.id} completion lost lease ownership`)
    }
    return fullResult
  }

  private parseCheckpoint<T>(schema: z.ZodType<T>, value: unknown, context: { runId: string; stepKey: string }): T {
    const parsed = schema.safeParse(value)
    if (parsed.success) return parsed.data
    logger.error(
      { error: parsed.error, runId: context.runId, stepKey: context.stepKey },
      "Invalid general research checkpoint payload"
    )
    throw new Error(`Invalid general research checkpoint payload for ${context.stepKey}`)
  }

  private partial(
    state: ExecutionState,
    input: GeneralResearchInput,
    plan: ResearchPlan | null,
    topicResults: Array<{ sources: SourceItem[]; topic: TopicPlan }>,
    reason: "user_abort" | "timeout"
  ): Promise<GeneralResearchResult> {
    const answer =
      topicResults.length > 0
        ? `Research was stopped. I completed ${topicResults.length} of ${plan?.topics.length ?? topicResults.length} topics and can answer from the partial findings.`
        : "Research was stopped before enough information was gathered."
    return this.complete(state, {
      status: "partial",
      answer,
      sources: normalizeSources(topicResults.flatMap((r) => r.sources)),
      effort: plan?.effort,
      topicsCompleted: topicResults.length,
      topicsPlanned: plan?.topics.length ?? topicResults.length,
      surfacesUsed: [...new Set((plan?.topics ?? topicResults.map((r) => r.topic)).flatMap((t) => t.surfaces))],
      partialReason: reason,
    })
  }

  private emit(state: ExecutionState, input: GeneralResearchInput, text: string): void {
    const substep = { text, at: new Date().toISOString() }
    state.substeps.push(substep)
    input.onSubstep?.(text)
  }

  private shouldStop(input: GeneralResearchInput): boolean {
    if (input.signal?.aborted) return true
    return Boolean(input.deadlineAt && Date.now() >= input.deadlineAt)
  }
}
