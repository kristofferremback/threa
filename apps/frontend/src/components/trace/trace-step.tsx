import { Link } from "react-router-dom"
import {
  AgentReconsiderationDecisions,
  type AgentSessionStep,
  type AgentStepType,
  type TraceSource,
} from "@threa/types"
import { cn } from "@/lib/utils"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { RelativeTime } from "@/components/relative-time"
import { formatDuration } from "@/lib/dates"
import { STEP_DISPLAY_CONFIG } from "@/lib/step-config"
import { ChevronRight, ExternalLink, type LucideIcon } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { FileText } from "lucide-react"

interface TraceStepProps {
  step: AgentSessionStep
  workspaceId: string
  streamId: string
}

export function TraceStep({ step, workspaceId, streamId }: TraceStepProps) {
  const config = STEP_DISPLAY_CONFIG[step.stepType]
  const Icon = config.icon

  const duration = step.duration ? formatDuration(step.duration) : null
  const hasSources = step.sources && step.sources.length > 0
  const messageLink = step.messageId ? `/w/${workspaceId}/s/${streamId}?m=${step.messageId}` : null

  return (
    <div
      className="px-6 py-5 border-b border-border"
      style={{
        background: `hsl(${config.hue} ${config.saturation}% ${config.lightness}% / 0.03)`,
      }}
    >
      <StepHeader config={config} Icon={Icon} startedAt={step.startedAt} duration={duration} />

      {step.content && <StepContent stepType={step.stepType} content={step.content} messageLink={messageLink} />}

      {hasSources && <SourceList sources={step.sources!} config={config} workspaceId={workspaceId} />}
    </div>
  )
}

interface StepHeaderProps {
  config: { label: string; hue: number; saturation: number; lightness: number }
  Icon: LucideIcon
  startedAt: string
  duration: string | null
}

function StepHeader({ config, Icon, startedAt, duration }: StepHeaderProps) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <div
        className="px-2.5 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wide inline-flex items-center gap-1.5"
        style={{
          background: `hsl(${config.hue} ${config.saturation}% ${config.lightness}% / 0.15)`,
          color: `hsl(${config.hue} ${config.saturation}% ${config.lightness}%)`,
        }}
      >
        <Icon className="w-3.5 h-3.5" />
        {config.label}
      </div>
      <div className="flex items-center gap-2 ml-auto text-[11px] text-muted-foreground">
        <RelativeTime date={startedAt} className="text-[11px] text-muted-foreground" />
        {duration && (
          <>
            <span>•</span>
            <span>{duration}</span>
          </>
        )}
      </div>
    </div>
  )
}

/** Parse structured JSON content, returning null if not valid JSON */
function parseStructuredContent(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content)
    if (typeof parsed === "object" && parsed !== null) return parsed
  } catch {
    // Not JSON — plain text content (e.g., LLM thinking output)
  }
  return null
}

function StepContent({
  stepType,
  content,
  messageLink,
}: {
  stepType: AgentStepType
  content: string
  messageLink: string | null
}) {
  const structured = parseStructuredContent(content)

  return <div className="text-sm leading-relaxed">{renderStepContent(stepType, content, structured, messageLink)}</div>
}

/** Message info as stored in context_received and reconsidering steps */
interface MessageInfo {
  messageId: string
  authorName: string
  authorType: "member" | "persona" | "system"
  changeType?: "message_created" | "message_edited" | "message_deleted"
  createdAt: string
  content: string
  isTrigger?: boolean
}

interface RerunContextInfo {
  cause: "invoking_message_edited" | "referenced_message_edited"
  editedMessageId: string
  editedMessageBefore?: string | null
  editedMessageAfter?: string | null
}

function renderStepContent(
  stepType: AgentStepType,
  content: string,
  structured: Record<string, unknown> | null,
  messageLink: string | null
): React.ReactNode {
  switch (stepType) {
    case "context_received": {
      if (structured && "messages" in structured) {
        const messages = structured.messages as MessageInfo[]
        const rerunContext = (structured.rerunContext as RerunContextInfo | undefined) ?? null
        const triggerMessage = messages.find((m) => m.isTrigger)
        const contextMessages = messages.filter((m) => !m.isTrigger)

        return (
          <div className="space-y-3">
            {rerunContext && <RerunContextSummary rerunContext={rerunContext} />}

            {/* Trigger message - highlighted */}
            {triggerMessage && (
              <div>
                <div className="text-muted-foreground text-[11px] mb-1.5 font-medium">Triggered by:</div>
                <MessagePreview message={triggerMessage} highlight />
              </div>
            )}

            {/* Context messages */}
            {contextMessages.length > 0 && (
              <div>
                <div className="text-muted-foreground text-[11px] mb-1.5">Recent context:</div>
                <div className="space-y-1.5">
                  {contextMessages.map((msg) => (
                    <MessagePreview key={msg.messageId} message={msg} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      }
      return <span className="text-muted-foreground">Processing messages...</span>
    }

    case "thinking": {
      if (structured && "toolPlan" in structured) {
        const tools = structured.toolPlan as string[]
        return <span className="text-muted-foreground">Planning to use: {tools.join(", ")}</span>
      }
      return <MarkdownContent content={content} className="text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
    }

    case "reconsidering": {
      if (structured && structured.decision === AgentReconsiderationDecisions.KEPT_PREVIOUS_RESPONSE) {
        const reason = typeof structured.reason === "string" ? structured.reason : null
        return (
          <div className="space-y-2">
            <div className="text-muted-foreground">
              Kept the previous response unchanged after reconsidering the updated context.
            </div>
            {reason && (
              <div className="rounded bg-muted/50 px-3 py-2 text-xs">
                <span className="font-medium">Reason:</span> {reason}
              </div>
            )}
          </div>
        )
      }

      if (structured && "draftResponse" in structured) {
        const draft = structured.draftResponse as string
        const newMessages = (structured.newMessages as MessageInfo[]) ?? []
        const hasMutatedMessages = newMessages.some(
          (message) => message.changeType === "message_edited" || message.changeType === "message_deleted"
        )
        return (
          <div className="space-y-3">
            {/* New messages that arrived */}
            {newMessages.length > 0 && (
              <div>
                <div className="text-muted-foreground text-[11px] mb-1.5 font-medium">
                  {hasMutatedMessages
                    ? "Message changes arrived:"
                    : `New ${newMessages.length === 1 ? "message" : "messages"} arrived:`}
                </div>
                <div className="space-y-1.5">
                  {newMessages.map((msg) => (
                    <MessagePreview key={msg.messageId} message={msg} highlight />
                  ))}
                </div>
              </div>
            )}

            {/* Draft response that's being reconsidered */}
            <div>
              <div className="text-muted-foreground text-[11px] mb-1.5">Draft being reconsidered:</div>
              <div className="rounded bg-muted/50 px-3 py-2 text-xs italic">
                <MarkdownContent
                  content={draft.length > 200 ? draft.slice(0, 200) + "..." : draft}
                  className="text-xs"
                />
              </div>
            </div>
          </div>
        )
      }
      return <span className="text-muted-foreground">Reconsidering response due to new context</span>
    }

    case "web_search":
      return (
        <span>
          <strong>Query:</strong> "{content}"
        </span>
      )

    case "workspace_search": {
      if (structured && "memoCount" in structured) {
        const memoCount = structured.memoCount as number
        const messageCount = structured.messageCount as number
        return (
          <span className="text-muted-foreground">
            Found {memoCount} {memoCount === 1 ? "memo" : "memos"} and {messageCount} related{" "}
            {messageCount === 1 ? "message" : "messages"}
          </span>
        )
      }
      return <span className="text-muted-foreground">{content}</span>
    }

    case "visit_page": {
      if (structured && "title" in structured) {
        return <span>{structured.title as string}</span>
      }
      if (structured && "url" in structured) {
        return <span className="text-muted-foreground">{structured.url as string}</span>
      }
      return <span>{content}</span>
    }

    case "message_sent": {
      const messagePreview = content.length > 100 ? content.slice(0, 100) + "..." : content
      return (
        <div className="group">
          <span className="text-muted-foreground">Sent message: </span>
          <span className="inline">
            "<MarkdownContent content={messagePreview} className="inline text-sm" />"
          </span>
          {messageLink && (
            <Link
              to={messageLink}
              className="inline-flex items-center gap-1 ml-2 text-xs text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
            >
              View message
              <ExternalLink className="w-3 h-3" />
            </Link>
          )}
        </div>
      )
    }

    case "message_edited": {
      const messagePreview = content.length > 100 ? content.slice(0, 100) + "..." : content
      return (
        <div className="group">
          <span className="text-muted-foreground">Updated previous message: </span>
          <span className="inline">
            "<MarkdownContent content={messagePreview} className="inline text-sm" />"
          </span>
          {messageLink && (
            <Link
              to={messageLink}
              className="inline-flex items-center gap-1 ml-2 text-xs text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
            >
              View message
              <ExternalLink className="w-3 h-3" />
            </Link>
          )}
        </div>
      )
    }

    case "tool_call": {
      if (structured && "tool" in structured) {
        const tool = structured.tool as string
        const query = structured.query as string | undefined
        const stream = structured.stream as string | undefined
        if (query) {
          return (
            <span>
              <strong>{tool}:</strong> "{query}"{stream && <span className="text-muted-foreground"> in {stream}</span>}
            </span>
          )
        }
        if (stream) {
          return (
            <span>
              <strong>{tool}:</strong> <span className="text-muted-foreground">{stream}</span>
            </span>
          )
        }
        return (
          <span>
            <strong>{tool}</strong>
            {"args" in structured && (
              <span className="text-muted-foreground ml-1 text-xs font-mono">{JSON.stringify(structured.args)}</span>
            )}
          </span>
        )
      }
      return <span>{content}</span>
    }

    default:
      return <span>{content}</span>
  }
}

function RerunContextSummary({ rerunContext }: { rerunContext: RerunContextInfo }) {
  const causeLabel =
    rerunContext.cause === "invoking_message_edited"
      ? "Rerun caused by invoking message edit"
      : "Rerun caused by follow-up message edit"

  const before = rerunContext.editedMessageBefore?.trim()
  const after = rerunContext.editedMessageAfter?.trim()

  return (
    <div className="rounded bg-muted/40 px-3 py-2 space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">{causeLabel}</div>
      {before && after && before !== after ? (
        <div className="text-xs">
          <span className="font-medium">Edit:</span> "{before}" → "{after}"
        </div>
      ) : after ? (
        <div className="text-xs">
          <span className="font-medium">Edited message:</span> "{after}"
        </div>
      ) : null}
    </div>
  )
}

interface SourceListProps {
  sources: TraceSource[]
  config: { hue: number; saturation: number; lightness: number }
  workspaceId: string
}

function SourceList({ sources, config, workspaceId }: SourceListProps) {
  return (
    <Collapsible className="mt-4">
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-left group">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <FileText className="w-4 h-4" />
          Sources
          <span className="bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full text-[11px] font-semibold">
            {sources.length}
          </span>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div
          className="mt-2 rounded-md text-xs"
          style={{
            background: "hsl(var(--muted) / 0.3)",
            borderLeft: `3px solid hsl(${config.hue} ${config.saturation}% ${config.lightness}%)`,
          }}
        >
          {sources.map((source, i) => (
            <SourceItem key={i} source={source} workspaceId={workspaceId} isLast={i === sources.length - 1} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function SourceItem({ source, workspaceId, isLast }: { source: TraceSource; workspaceId: string; isLast: boolean }) {
  const internalLink = buildSourceLink(source, workspaceId)

  return (
    <div className={cn("px-2.5 py-1.5 mx-[-1px]", !isLast && "border-b border-border")}>
      <div className="font-semibold mb-1 text-xs">
        <SourceTitle source={source} internalLink={internalLink} />
      </div>
      {source.domain && <div className="text-[11px] text-muted-foreground mb-1">{source.domain}</div>}
      {source.authorName && source.type === "workspace_message" && (
        <div className="text-[11px] text-muted-foreground mb-1">
          by {source.authorName}
          {source.streamName && ` in ${source.streamName}`}
        </div>
      )}
      {source.streamName && source.type === "workspace_memo" && (
        <div className="text-[11px] text-muted-foreground mb-1">from {source.streamName}</div>
      )}
      {source.snippet && (
        <div className="text-muted-foreground text-[11px] leading-snug line-clamp-2">{source.snippet}</div>
      )}
    </div>
  )
}

function buildSourceLink(source: TraceSource, workspaceId: string): string | null {
  if (source.type === "workspace_message" && source.streamId && source.messageId) {
    return `/w/${workspaceId}/s/${source.streamId}?m=${source.messageId}`
  }
  if (source.type === "workspace_memo" && source.streamId) {
    return `/w/${workspaceId}/s/${source.streamId}`
  }
  return null
}

function SourceTitle({ source, internalLink }: { source: TraceSource; internalLink: string | null }) {
  if (internalLink) {
    return (
      <Link to={internalLink} className="text-primary hover:underline">
        {source.title}
      </Link>
    )
  }
  if (source.url) {
    return (
      <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
        {source.title}
      </a>
    )
  }
  return <>{source.title}</>
}

/** Preview of a message in context_received or reconsidering steps */
function MessagePreview({ message, highlight }: { message: MessageInfo; highlight?: boolean }) {
  const isPersona = message.authorType === "persona"
  const messageChangeLabel = getMessageChangeLabel(message.changeType)
  // Truncate long content but preserve markdown structure
  const preview = message.content.length > 150 ? message.content.slice(0, 150) + "..." : message.content

  return (
    <div
      className={cn("rounded px-3 py-2 text-xs", highlight ? "bg-primary/10 border border-primary/20" : "bg-muted/50")}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={cn("font-medium", isPersona && "text-primary")}>{message.authorName}</span>
        {messageChangeLabel && (
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {messageChangeLabel}
          </span>
        )}
        <span className="text-muted-foreground text-[10px]">
          <RelativeTime date={message.createdAt} className="text-[10px] text-muted-foreground" />
        </span>
      </div>
      <MarkdownContent content={preview} className="text-xs leading-relaxed text-foreground/90" />
    </div>
  )
}

function getMessageChangeLabel(changeType: MessageInfo["changeType"]): string | null {
  switch (changeType) {
    case "message_created":
      return "New"
    case "message_edited":
      return "Edited"
    case "message_deleted":
      return "Deleted"
    default:
      return null
  }
}
