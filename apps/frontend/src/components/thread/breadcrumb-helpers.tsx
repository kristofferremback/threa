import { Link } from "react-router-dom"
import { BreadcrumbItem, BreadcrumbLink, BreadcrumbSeparator } from "@/components/ui/breadcrumb"

interface StreamInfo {
  id: string
  type: string
  displayName: string | null
  slug?: string | null
  rootStreamId?: string | null
}

interface StreamForLookup {
  id: string
  type: string
  displayName: string | null
  slug?: string | null
}

/**
 * Get a descriptive display name for a thread based on its root stream.
 * Format: "Thread in #channel", "Thread in [Scratchpad name]", "Thread with [User(s)]"
 */
export function getThreadDisplayName(thread: { rootStreamId: string | null }, allStreams: StreamForLookup[]): string {
  if (!thread.rootStreamId) {
    return "Thread"
  }

  const rootStream = allStreams.find((s) => s.id === thread.rootStreamId)
  if (!rootStream) {
    return "Thread"
  }

  switch (rootStream.type) {
    case "channel":
      return `Thread in #${rootStream.slug || rootStream.displayName || "channel"}`
    case "scratchpad":
      return `Thread in ${rootStream.displayName || "Scratchpad"}`
    case "dm":
      return `Thread with ${rootStream.displayName || "DM"}`
    default:
      return "Thread"
  }
}

/**
 * Get display name for a stream in breadcrumbs
 */
export function getStreamBreadcrumbName(stream: StreamInfo): string {
  if (stream.type === "thread") {
    return stream.displayName || "Thread"
  }
  if (stream.slug) {
    return `#${stream.slug}`
  }
  return stream.displayName || "..."
}

interface AncestorBreadcrumbItemProps {
  stream: StreamInfo
  isMainViewStream: boolean
  onClosePanel: () => void
  getNavigationUrl: (streamId: string) => string
}

/**
 * Renders a breadcrumb item for an ancestor stream.
 * If the stream is the main view, renders a button that closes the panel.
 * Otherwise, renders a link to navigate to the stream.
 */
export function AncestorBreadcrumbItem({
  stream,
  isMainViewStream,
  onClosePanel,
  getNavigationUrl,
}: AncestorBreadcrumbItemProps) {
  const displayName = getStreamBreadcrumbName(stream)

  if (isMainViewStream) {
    return (
      <div key={stream.id} className="contents">
        <BreadcrumbItem className="max-w-[120px]">
          <BreadcrumbLink asChild>
            <button
              onClick={onClosePanel}
              className="truncate block text-left hover:underline cursor-pointer bg-transparent border-0 p-0 font-inherit"
            >
              {displayName}
            </button>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
      </div>
    )
  }

  return (
    <div key={stream.id} className="contents">
      <BreadcrumbItem className="max-w-[120px]">
        <BreadcrumbLink asChild>
          <Link to={getNavigationUrl(stream.id)} className="truncate block">
            {displayName}
          </Link>
        </BreadcrumbLink>
      </BreadcrumbItem>
      <BreadcrumbSeparator />
    </div>
  )
}
