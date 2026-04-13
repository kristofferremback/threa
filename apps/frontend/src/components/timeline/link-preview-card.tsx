import { useState, useCallback } from "react"
import {
  ExternalLink,
  X,
  FileText,
  Image as ImageIcon,
  ChevronDown,
  ChevronRight,
  GitPullRequest,
  GitMerge,
  CircleDot,
  CircleCheck,
  GitCommitHorizontal,
  MessageSquare,
  FileCode,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { cn } from "@/lib/utils"
import type {
  GitHubFilePreviewData,
  GitHubPrPreviewData,
  GitHubIssuePreviewData,
  GitHubCommitPreviewData,
  GitHubCommentPreviewData,
  GitHubDiffPreviewData,
  GitHubPreview,
  GitHubPreviewActor,
  LinkPreviewSummary,
} from "@threa/types"

interface LinkPreviewCardProps {
  preview: LinkPreviewSummary
  isHighlighted?: boolean
  isCollapsed?: boolean
  onDismiss?: (previewId: string) => void
  onToggleCollapse?: (previewId: string) => void
}

function ContentTypeIcon({ contentType }: { contentType: string }) {
  switch (contentType) {
    case "pdf":
      return <FileText className="h-4 w-4 text-red-500 shrink-0" />
    case "image":
      return <ImageIcon className="h-4 w-4 text-blue-500 shrink-0" />
    default:
      return <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
  }
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

export function LinkPreviewCard({
  preview,
  isHighlighted,
  isCollapsed: isCollapsedProp,
  onDismiss,
  onToggleCollapse,
}: LinkPreviewCardProps) {
  const [imageError, setImageError] = useState(false)
  const domain = getDomain(preview.url)
  const githubPreview = preview.previewData

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onDismiss?.(preview.id)
    },
    [onDismiss, preview.id]
  )

  const handleToggleCollapse = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onToggleCollapse?.(preview.id)
    },
    [onToggleCollapse, preview.id]
  )

  // Image-type previews render as a thumbnail
  if (preview.contentType === "image") {
    return (
      <a
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "group/preview relative block overflow-hidden rounded-lg border bg-muted/30 transition-all max-w-xs",
          "hover:border-primary hover:shadow-sm",
          isHighlighted && "ring-2 ring-primary border-primary shadow-sm"
        )}
      >
        <div className="absolute top-1.5 right-1.5 z-10 flex gap-1 opacity-0 group-hover/preview:opacity-100 transition-opacity">
          {onDismiss && (
            <Button
              variant="secondary"
              size="icon"
              className="h-6 w-6 shadow-sm"
              onClick={handleDismiss}
              aria-label="Dismiss preview"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        {!imageError ? (
          <img
            src={preview.url}
            alt={preview.title ?? "Image preview"}
            className="h-32 w-auto max-w-xs object-cover"
            loading="lazy"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="flex h-32 w-40 items-center justify-center text-muted-foreground">
            <ImageIcon className="h-8 w-8" />
          </div>
        )}
        <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground">
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{domain}</span>
        </div>
      </a>
    )
  }

  // Resolve the header icon and label for GitHub previews
  const headerIcon = githubPreview ? (
    <GitHubTypeIcon type={githubPreview.type} data={githubPreview.data} />
  ) : (
    <ContentTypeIcon contentType={preview.contentType} />
  )

  const headerLabel = githubPreview ? githubPreview.repository.fullName : (preview.siteName ?? domain)

  // Website, PDF, and GitHub previews render as a card.
  // data-native-context tells the message-level long-press hook to skip
  // its timer so long-pressing anywhere on the card gets the browser's
  // native link menu (via the inner <a>) instead of the message drawer.
  return (
    <div
      data-native-context="true"
      className={cn(
        "group/preview relative overflow-hidden rounded-lg border bg-card transition-all max-w-md",
        "hover:border-primary/50 hover:shadow-sm",
        isHighlighted && "ring-2 ring-primary border-primary shadow-sm"
      )}
    >
      {/* Header with collapse/dismiss controls */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b bg-muted/30">
        <button
          type="button"
          onClick={handleToggleCollapse}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          aria-label={isCollapsedProp ? "Expand preview" : "Collapse preview"}
        >
          {isCollapsedProp ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {headerIcon}
        {!githubPreview && preview.faviconUrl && (
          <img
            src={preview.faviconUrl}
            alt=""
            className="h-3.5 w-3.5 rounded-sm"
            loading="lazy"
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = "none"
            }}
          />
        )}
        <span className="text-xs text-muted-foreground truncate">{headerLabel}</span>
        <ExternalLink className="h-3 w-3 text-muted-foreground/50 shrink-0 ml-auto" />
        <div className="flex gap-1 opacity-0 group-hover/preview:opacity-100 transition-opacity">
          {onDismiss && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={handleDismiss}
              aria-label="Dismiss preview"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Expandable content */}
      {!isCollapsedProp && (
        <a
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block hover:bg-muted/20 transition-colors"
        >
          <GitHubContent preview={preview} imageError={imageError} onImageError={() => setImageError(true)} />
        </a>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// GitHub type icon (state-aware)
// ---------------------------------------------------------------------------

function GitHubTypeIcon({ type, data }: { type: string; data: GitHubPreview["data"] }) {
  switch (type) {
    case "github_pr": {
      const pr = data as GitHubPrPreviewData
      if (pr.state === "merged") return <GitMerge className="h-3.5 w-3.5 text-purple-500 shrink-0" />
      if (pr.state === "closed") return <GitPullRequest className="h-3.5 w-3.5 text-red-500 shrink-0" />
      return <GitPullRequest className="h-3.5 w-3.5 text-green-500 shrink-0" />
    }
    case "github_issue": {
      const issue = data as GitHubIssuePreviewData
      if (issue.state === "closed") return <CircleCheck className="h-3.5 w-3.5 text-purple-500 shrink-0" />
      return <CircleDot className="h-3.5 w-3.5 text-green-500 shrink-0" />
    }
    case "github_commit":
      return <GitCommitHorizontal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    case "github_file":
      return <FileCode className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    case "github_diff":
      return <GitPullRequest className="h-3.5 w-3.5 text-green-500 shrink-0" />
    case "github_comment":
      return <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
    default:
      return <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
  }
}

// ---------------------------------------------------------------------------
// Content router
// ---------------------------------------------------------------------------

function GitHubContent({
  preview,
  imageError,
  onImageError,
}: {
  preview: LinkPreviewSummary
  imageError: boolean
  onImageError: () => void
}) {
  const ghPreview = preview.previewData
  if (!ghPreview) {
    return <GenericPreviewContent preview={preview} imageError={imageError} onImageError={onImageError} />
  }

  switch (ghPreview.type) {
    case "github_pr":
      return <GitHubPrContent data={ghPreview.data as GitHubPrPreviewData} />
    case "github_issue":
      return <GitHubIssueContent data={ghPreview.data as GitHubIssuePreviewData} />
    case "github_commit":
      return <GitHubCommitContent data={ghPreview.data as GitHubCommitPreviewData} />
    case "github_file":
      return <GitHubFileContent preview={preview} data={ghPreview.data as GitHubFilePreviewData} />
    case "github_diff":
      return <GitHubDiffContent data={ghPreview.data as GitHubDiffPreviewData} />
    case "github_comment":
      return <GitHubCommentContent data={ghPreview.data as GitHubCommentPreviewData} />
    default:
      return <GenericPreviewContent preview={preview} imageError={imageError} onImageError={onImageError} />
  }
}

function GenericPreviewContent({
  preview,
  imageError,
  onImageError,
}: {
  preview: LinkPreviewSummary
  imageError: boolean
  onImageError: () => void
}) {
  return (
    <div className="flex gap-3 p-3">
      <div className="flex-1 min-w-0">
        {preview.title && <h4 className="text-sm font-medium text-foreground line-clamp-2 mb-0.5">{preview.title}</h4>}
        {preview.description && <p className="text-xs text-muted-foreground line-clamp-2">{preview.description}</p>}
      </div>
      {preview.imageUrl && !imageError && (
        <img
          src={preview.imageUrl}
          alt=""
          className="h-16 w-24 rounded object-cover shrink-0"
          loading="lazy"
          onError={onImageError}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pull Request
// ---------------------------------------------------------------------------

function GitHubPrContent({ data }: { data: GitHubPrPreviewData }) {
  const stateLabels = { merged: "Merged", closed: "Closed", open: "Open" } as const
  const stateLabel = stateLabels[data.state]

  return (
    <div className="p-3">
      <div className="flex items-start gap-2">
        <ActorAvatar actor={data.author} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium text-foreground line-clamp-2">
            {data.title}
            <span className="ml-1.5 font-normal text-muted-foreground">#{data.number}</span>
          </h4>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <PrStateBadge state={data.state} label={stateLabel} />
            <span className="truncate max-w-[10rem]" title={`${data.headBranch} → ${data.baseBranch}`}>
              {data.headBranch}
              <span className="mx-0.5">{"\u2192"}</span>
              {data.baseBranch}
            </span>
            <DiffStats additions={data.additions} deletions={data.deletions} />
          </div>
          <ReviewSummary summary={data.reviewStatusSummary} />
        </div>
      </div>
    </div>
  )
}

function PrStateBadge({ state, label }: { state: "open" | "closed" | "merged"; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-px text-[11px] font-medium leading-tight",
        state === "open" && "bg-green-500/15 text-green-600 dark:text-green-400",
        state === "merged" && "bg-purple-500/15 text-purple-600 dark:text-purple-400",
        state === "closed" && "bg-red-500/15 text-red-600 dark:text-red-400"
      )}
    >
      {label}
    </span>
  )
}

function ReviewSummary({ summary }: { summary: GitHubPrPreviewData["reviewStatusSummary"] }) {
  const parts: string[] = []
  if (summary.approvals > 0) parts.push(`${summary.approvals} approved`)
  if (summary.changesRequested > 0) parts.push(`${summary.changesRequested} changes requested`)
  if (summary.pendingReviewers > 0) parts.push(`${summary.pendingReviewers} pending`)
  if (parts.length === 0) return null

  return <p className="mt-1 text-[11px] text-muted-foreground">{parts.join(" \u00b7 ")}</p>
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

function GitHubIssueContent({ data }: { data: GitHubIssuePreviewData }) {
  return (
    <div className="p-3">
      <div className="flex items-start gap-2">
        <ActorAvatar actor={data.author} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium text-foreground line-clamp-2">
            {data.title}
            <span className="ml-1.5 font-normal text-muted-foreground">#{data.number}</span>
          </h4>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-1.5 py-px text-[11px] font-medium leading-tight",
                data.state === "open"
                  ? "bg-green-500/15 text-green-600 dark:text-green-400"
                  : "bg-purple-500/15 text-purple-600 dark:text-purple-400"
              )}
            >
              {data.state === "open" ? "Open" : "Closed"}
            </span>
            {data.commentCount > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <MessageSquare className="h-3 w-3" />
                {data.commentCount}
              </span>
            )}
          </div>
          {data.labels.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {data.labels.slice(0, 4).map((label) => (
                <IssueLabel key={label.name} name={label.name} color={label.color} />
              ))}
              {data.labels.length > 4 && (
                <span className="text-[11px] text-muted-foreground">+{data.labels.length - 4}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function IssueLabel({ name, color }: { name: string; color: string }) {
  const hex = color.startsWith("#") ? color : `#${color}`
  return (
    <span
      className="inline-flex items-center rounded-full px-1.5 py-px text-[11px] font-medium leading-tight border"
      style={{
        backgroundColor: `${hex}20`,
        borderColor: `${hex}40`,
        color: hex,
      }}
    >
      {name}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

function GitHubCommitContent({ data }: { data: GitHubCommitPreviewData }) {
  const firstLine = data.message.split("\n")[0]

  return (
    <div className="p-3">
      <div className="flex items-start gap-2">
        <ActorAvatar actor={data.author} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium text-foreground line-clamp-2">{firstLine}</h4>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <code className="rounded bg-muted px-1 py-px font-mono text-[11px]">{data.shortSha}</code>
            <span>
              {data.filesChanged} file{data.filesChanged !== 1 ? "s" : ""}
            </span>
            <DiffStats additions={data.additions} deletions={data.deletions} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// File
// ---------------------------------------------------------------------------

function GitHubFileContent({ preview, data }: { preview: LinkPreviewSummary; data: GitHubFilePreviewData }) {
  let content = null

  if (data.renderMode === "markdown" && data.markdownContent) {
    content = (
      <div className="mt-2 overflow-hidden rounded-md border bg-muted/20 px-2.5 py-1.5">
        <MarkdownContent
          content={data.markdownContent}
          className="text-xs leading-relaxed text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
        />
      </div>
    )
  } else if (data.lines.length > 0) {
    content = (
      <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/20 px-2.5 py-1.5 text-xs leading-snug font-mono text-foreground">
        {data.lines.map((line) => line.text).join("\n")}
      </pre>
    )
  }

  return (
    <div className="p-3">
      <div className="min-w-0">
        {preview.title && <h4 className="text-sm font-medium text-foreground line-clamp-1">{preview.title}</h4>}
        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
          {preview.previewData?.repository.fullName}
          {" \u00b7 "}
          {data.ref}
          {data.language ? ` \u00b7 ${data.language}` : ""}
          {data.renderMode !== "markdown" ? ` \u00b7 ${formatLineRange(data)}` : ""}
        </p>
      </div>

      {content}

      {data.truncated && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {data.renderMode === "markdown"
            ? "Showing the beginning of the README only."
            : "Showing the first snippet lines only."}
        </p>
      )}
    </div>
  )
}

function GitHubDiffContent({ data }: { data: GitHubDiffPreviewData }) {
  return (
    <div className="p-3">
      <div className="min-w-0">
        <h4 className="text-sm font-medium text-foreground line-clamp-1">{data.path}</h4>
        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
          PR #{data.pullRequest.number} · {data.pullRequest.title} · {capitalizeChangeType(data.changeType)}
          {data.language ? ` · ${data.language}` : ""}
          {formatDiffAnchor(data)}
        </p>
        {data.previousPath && data.previousPath !== data.path && (
          <p className="mt-1 text-[11px] text-muted-foreground">Renamed from {data.previousPath}</p>
        )}
      </div>

      <div className="mt-2 overflow-hidden rounded-md border bg-muted/20">
        <div className="overflow-x-auto font-mono text-xs leading-snug text-foreground">
          {data.lines.map((line, index) => (
            <div
              key={`${line.oldNumber ?? "x"}-${line.newNumber ?? "x"}-${index}`}
              className={cn(
                "grid grid-cols-[2.75rem_2.75rem_1fr] items-start",
                line.type === "add" && "bg-green-500/10",
                line.type === "delete" && "bg-red-500/10",
                line.selected && "bg-primary/10 ring-1 ring-inset ring-primary/20"
              )}
            >
              <span className="px-2 py-1 text-right text-muted-foreground">{line.oldNumber ?? ""}</span>
              <span className="px-2 py-1 text-right text-muted-foreground">{line.newNumber ?? ""}</span>
              <span className="px-2 py-1 whitespace-pre">
                <span
                  className={cn(
                    "mr-2 inline-block w-3 text-center",
                    line.type === "add" && "text-green-700 dark:text-green-300",
                    line.type === "delete" && "text-red-700 dark:text-red-300",
                    line.type === "context" && "text-muted-foreground"
                  )}
                >
                  {getDiffLinePrefix(line.type)}
                </span>
                {line.text}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        <DiffStats additions={data.additions} deletions={data.deletions} />
        {data.truncated && (
          <span>
            {data.anchorStartLine ? "Showing the linked diff hunk only." : "Showing the beginning of the diff only."}
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Comment
// ---------------------------------------------------------------------------

function GitHubCommentContent({ data }: { data: GitHubCommentPreviewData }) {
  const parentLabel = data.parent.kind === "pull_request" ? "PR" : "Issue"

  return (
    <div className="p-3">
      <div className="flex items-start gap-2">
        <ActorAvatar actor={data.author} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground line-clamp-1">
            <span className="font-medium text-foreground">{data.author?.login ?? "Unknown"}</span>
            {" commented on "}
            {parentLabel} #{data.parent.number}
          </p>
          {data.body && (
            <div className="mt-1.5 overflow-hidden rounded-md border bg-muted/20 px-2.5 py-1.5">
              <MarkdownContent
                content={data.body}
                className="text-xs leading-relaxed text-foreground line-clamp-4 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
              />
            </div>
          )}
          {data.truncated && <p className="mt-1 text-[11px] text-muted-foreground">Comment truncated</p>}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function ActorAvatar({ actor, className }: { actor: GitHubPreviewActor | null; className?: string }) {
  if (!actor) return null
  return (
    <Avatar className={cn("h-5 w-5 shrink-0", className)}>
      {actor.avatarUrl ? <AvatarImage src={actor.avatarUrl} alt={actor.login} /> : null}
      <AvatarFallback className="text-[10px]">{actor.login.charAt(0).toUpperCase()}</AvatarFallback>
    </Avatar>
  )
}

function DiffStats({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      {additions > 0 && <span className="text-green-600 dark:text-green-400">+{additions}</span>}
      {deletions > 0 && <span className="text-red-600 dark:text-red-400">-{deletions}</span>}
    </span>
  )
}

function formatLineRange(data: GitHubFilePreviewData): string {
  return data.startLine === data.endLine ? `L${data.startLine}` : `L${data.startLine}-L${data.endLine}`
}

function formatDiffAnchor(data: GitHubDiffPreviewData): string {
  if (!data.anchorSide || !data.anchorStartLine) return ""
  const prefix = data.anchorSide === "left" ? " L" : " R"
  if (!data.anchorEndLine || data.anchorEndLine === data.anchorStartLine) {
    return `${prefix}${data.anchorStartLine}`
  }
  return `${prefix}${data.anchorStartLine}-${data.anchorEndLine}`
}

function capitalizeChangeType(changeType: GitHubDiffPreviewData["changeType"]): string {
  return changeType.charAt(0).toUpperCase() + changeType.slice(1)
}

function getDiffLinePrefix(type: GitHubDiffPreviewData["lines"][number]["type"]): string {
  if (type === "add") return "+"
  if (type === "delete") return "-"
  return " "
}
