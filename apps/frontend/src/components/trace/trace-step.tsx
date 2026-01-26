import { useState } from "react"
import { Link } from "react-router-dom"
import type { AgentSessionStep, AgentStepType, TraceSource } from "@threa/types"
import { cn } from "@/lib/utils"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { RelativeTime } from "@/components/relative-time"
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
  // HSL values for the badge and background
  hue: number
  saturation: number
  lightness: number
}

const STEP_CONFIGS: Record<AgentStepType, StepConfig> = {
  thinking: {
    label: "Thinking",
    icon: Lightbulb,
    hue: 45, // Gold/primary
    saturation: 93,
    lightness: 47,
  },
  web_search: {
    label: "Web Search",
    icon: Search,
    hue: 200, // Teal/blue
    saturation: 70,
    lightness: 50,
  },
  visit_page: {
    label: "Reading Page",
    icon: FileText,
    hue: 200,
    saturation: 70,
    lightness: 50,
  },
  workspace_search: {
    label: "Workspace Search",
    icon: Building2,
    hue: 270, // Purple
    saturation: 60,
    lightness: 50,
  },
  message_sent: {
    label: "Response",
    icon: MessageSquare,
    hue: 142, // Green
    saturation: 76,
    lightness: 36,
  },
  tool_call: {
    label: "Tool Call",
    icon: Wrench,
    hue: 200,
    saturation: 70,
    lightness: 50,
  },
  tool_error: {
    label: "Error",
    icon: AlertTriangle,
    hue: 0, // Red
    saturation: 72,
    lightness: 51,
  },
}

interface TraceStepProps {
  step: AgentSessionStep
  workspaceId: string
  streamId: string
}

export function TraceStep({ step, workspaceId, streamId }: TraceStepProps) {
  const [isSourcesOpen, setIsSourcesOpen] = useState(false)
  const config = STEP_CONFIGS[step.stepType]
  const Icon = config.icon

  const duration = step.duration
    ? step.duration < 1000
      ? `${step.duration}ms`
      : `${(step.duration / 1000).toFixed(1)}s`
    : null

  const hasSources = step.sources && step.sources.length > 0
  const hasContent = step.content

  // Build the link to the message if this step has a messageId
  const messageLink = step.messageId ? `/w/${workspaceId}/s/${streamId}?highlight=${step.messageId}` : null

  return (
    <div
      className="px-6 py-5 border-b border-border"
      style={{
        background: `hsl(${config.hue} ${config.saturation}% ${config.lightness}% / 0.03)`,
      }}
    >
      {/* Step header with badge and duration */}
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
          <RelativeTime date={step.startedAt} className="text-[11px] text-muted-foreground" />
          {duration && (
            <>
              <span>•</span>
              <span>{duration}</span>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      {hasContent && (
        <div className="text-sm leading-relaxed">
          {step.stepType === "thinking" ? (
            <MarkdownContent content={step.content!} className="text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0" />
          ) : step.stepType === "web_search" ? (
            <span>
              <strong>Query:</strong> "{step.content}"
            </span>
          ) : step.stepType === "message_sent" ? (
            <div className="group">
              <span className="text-muted-foreground">Sent message: </span>
              <span>
                "{step.content && step.content.length > 100 ? step.content.slice(0, 100) + "..." : step.content}"
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
          ) : (
            <span>{step.content}</span>
          )}
        </div>
      )}

      {/* Sources section */}
      {hasSources && (
        <div className="mt-4">
          <button
            onClick={() => setIsSourcesOpen(!isSourcesOpen)}
            className="flex items-center justify-between w-full py-2 text-left"
          >
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <FileText className="w-4 h-4" />
              Sources
              <span className="bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full text-[11px] font-semibold">
                {step.sources!.length}
              </span>
            </div>
            <ChevronRight
              className={cn("w-4 h-4 text-muted-foreground transition-transform", isSourcesOpen && "rotate-90")}
            />
          </button>

          {isSourcesOpen && (
            <div
              className="mt-2 rounded-md text-xs"
              style={{
                background: "hsl(var(--muted) / 0.3)",
                borderLeft: `3px solid hsl(${config.hue} ${config.saturation}% ${config.lightness}%)`,
              }}
            >
              {step.sources!.map((source, i) => (
                <SourceItem key={i} source={source} workspaceId={workspaceId} isLast={i === step.sources!.length - 1} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SourceItem({ source, workspaceId, isLast }: { source: TraceSource; workspaceId: string; isLast: boolean }) {
  // Build internal link for workspace sources
  const internalLink =
    source.type === "workspace_message" && source.streamId && source.messageId
      ? `/w/${workspaceId}/s/${source.streamId}?highlight=${source.messageId}`
      : source.type === "workspace_memo" && source.streamId
        ? `/w/${workspaceId}/s/${source.streamId}`
        : null

  return (
    <div className={cn("px-2.5 py-1.5 mx-[-1px]", !isLast && "border-b border-border")}>
      <div className="font-semibold mb-1 text-xs">
        {internalLink ? (
          <Link to={internalLink} className="text-primary hover:underline">
            {source.title}
          </Link>
        ) : source.url ? (
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            {source.title}
          </a>
        ) : (
          source.title
        )}
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
