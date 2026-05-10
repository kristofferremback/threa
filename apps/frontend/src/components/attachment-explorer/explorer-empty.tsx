import { Inbox, AlertCircle, Filter } from "lucide-react"
import { Button } from "@/components/ui/button"

type EmptyKind = "empty" | "filtered-empty" | "error"

interface ExplorerEmptyProps {
  kind: EmptyKind
  onClearFilters?: () => void
  onWidenScope?: () => void
}

const COPY: Record<EmptyKind, { title: string; body: string; icon: typeof Inbox; accent: string }> = {
  empty: {
    title: "No files yet",
    body: "Once you or your team upload attachments, they'll show up here, most recent first.",
    icon: Inbox,
    accent: "bg-primary/10 text-primary",
  },
  "filtered-empty": {
    title: "Nothing in this scope",
    body: "Try clearing filters or widening the search to the whole workspace.",
    icon: Filter,
    accent: "bg-muted text-muted-foreground",
  },
  error: {
    title: "Couldn't load files",
    body: "Something went wrong loading attachments. Try again in a moment.",
    icon: AlertCircle,
    accent: "bg-destructive/10 text-destructive",
  },
}

export function ExplorerEmpty({ kind, onClearFilters, onWidenScope }: ExplorerEmptyProps) {
  const { title, body, icon: Icon, accent } = COPY[kind]
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center"
    >
      <div className={`flex h-12 w-12 items-center justify-center rounded-card ${accent}`}>
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <div className="space-y-1">
        <div className="text-sm font-medium">{title}</div>
        <p className="max-w-[26ch] text-xs text-muted-foreground">{body}</p>
      </div>
      {kind === "filtered-empty" ? (
        <div className="flex gap-2">
          {onClearFilters ? (
            <Button size="sm" variant="outline" onClick={onClearFilters}>
              Clear filters
            </Button>
          ) : null}
          {onWidenScope ? (
            <Button size="sm" onClick={onWidenScope}>
              Search all files
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
