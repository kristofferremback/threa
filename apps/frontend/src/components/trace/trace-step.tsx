import { useState } from "react"
import { Link } from "react-router-dom"
import type { AgentSessionStep, AgentStepType, TraceSource } from "@threa/types"
import { cn } from "@/lib/utils"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { RelativeTime } from "@/components/relative-time"
import { formatDuration } from "@/lib/dates"
import {
  ChevronRight,
  Lightbulb,
  Search,
  FileText,
  Building2,
  MessageSquare,
  Wrench,
  AlertTriangle,
  ExternalLink,
} from "lucide-react"

interface StepConfig {
  label: string
  icon: typeof Lightbulb
  hue: number
  saturation: number
  lightness: number
}

const STEP_CONFIGS: Record<AgentStepType, StepConfig> = {
  thinking: { label: "Thinking", icon: Lightbulb, hue: 45, saturation: 93, lightness: 47 },
  web_search: { label: "Web Search", icon: Search, hue: 200, saturation: 70, lightness: 50 },
  visit_page: { label: "Reading Page", icon: FileText, hue: 200, saturation: 70, lightness: 50 },
  workspace_search: { label: "Workspace Search", icon: Building2, hue: 270, saturation: 60, lightness: 50 },
  message_sent: { label: "Response", icon: MessageSquare, hue: 142, saturation: 76, lightness: 36 },
  tool_call: { label: "Tool Call", icon: Wrench, hue: 200, saturation: 70, lightness: 50 },
  tool_error: { label: "Error", icon: AlertTriangle, hue: 0, saturation: 72, lightness: 51 },
}

interface TraceStepProps {
  step: AgentSessionStep
  workspaceId: string
  streamId: string
}

export function TraceStep({ step, workspaceId, streamId }: TraceStepProps) {
  const config = STEP_CONFIGS[step.stepType]
  const Icon = config.icon

  const duration = step.duration ? formatDuration(step.duration) : null
  const hasSources = step.sources && step.sources.length > 0
  const messageLink = step.messageId ? `/w/${workspaceId}/s/${streamId}?highlight=${step.messageId}` : null

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

function StepHeader({
  config,
  Icon,
  startedAt,
  duration,
}: {
  config: StepConfig
  Icon: typeof Lightbulb
  startedAt: string
  duration: string | null
}) {
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

function renderStepContent(
  stepType: AgentStepType,
  content: string,
  structured: Record<string, unknown> | null,
  messageLink: string | null
): React.ReactNode {
  switch (stepType) {
    case "thinking": {
      if (structured && "toolPlan" in structured) {
        const tools = structured.toolPlan as string[]
        return <span className="text-muted-foreground">Planning to use: {tools.join(", ")}</span>
      }
      return <MarkdownContent content={content} className="text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
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

    case "message_sent":
      return (
        <div className="group">
          <span className="text-muted-foreground">Sent message: </span>
          <span>"{content.length > 100 ? content.slice(0, 100) + "..." : content}"</span>
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

function SourceList({
  sources,
  config,
  workspaceId,
}: {
  sources: TraceSource[]
  config: StepConfig
  workspaceId: string
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="mt-4">
      <button onClick={() => setIsOpen(!isOpen)} className="flex items-center justify-between w-full py-2 text-left">
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <FileText className="w-4 h-4" />
          Sources
          <span className="bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full text-[11px] font-semibold">
            {sources.length}
          </span>
        </div>
        <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
      </button>

      {isOpen && (
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
      )}
    </div>
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
    return `/w/${workspaceId}/s/${source.streamId}?highlight=${source.messageId}`
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
