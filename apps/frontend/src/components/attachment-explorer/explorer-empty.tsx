import { Inbox, AlertCircle, Filter } from "lucide-react"
import { Button } from "@/components/ui/button"

type EmptyKind = "empty" | "filtered-empty" | "error"

interface ExplorerEmptyProps {
  kind: EmptyKind
  onClearFilters?: () => void
  onWidenScope?: () => void
}

const COPY: Record<EmptyKind, { title: string; body: string; icon: typeof Inbox }> = {
  empty: {
    title: "No files yet",
    body: "Once you or your team upload attachments, they'll show up here, most recent first.",
    icon: Inbox,
  },
  "filtered-empty": {
    title: "Nothing in this scope",
    body: "Try clearing filters or widening the search to the whole workspace.",
    icon: Filter,
  },
  error: {
    title: "Couldn't load files",
    body: "Something went wrong loading attachments. Try again in a moment.",
    icon: AlertCircle,
  },
}

export function ExplorerEmpty({ kind, onClearFilters, onWidenScope }: ExplorerEmptyProps) {
  const { title, body, icon: Icon } = COPY[kind]
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center"
    >
      <Icon className="h-8 w-8 text-muted-foreground" aria-hidden />
      <div className="space-y-1">
        <div className="text-sm font-medium">{title}</div>
        <p className="text-xs text-muted-foreground">{body}</p>
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
