import { Skeleton } from "@/components/ui/skeleton"

/**
 * Sidebar skeleton matching the structure of the real Sidebar component.
 * Used during coordinated loading when sidebar data is not yet available.
 */
export function SidebarSkeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b px-4">
        <Skeleton className="h-5 w-32" />
        <div className="flex items-center gap-1">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>

      {/* Drafts link */}
      <div className="border-b px-2 py-2">
        <Skeleton className="h-9 w-full rounded-md" />
      </div>

      {/* Stream list */}
      <div className="flex-1 overflow-hidden p-2">
        {/* Scratchpads section */}
        <div className="mb-4">
          <Skeleton className="mb-2 h-3 w-20 px-2" />
          <div className="space-y-1">
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="h-8 w-full rounded-md" />
          </div>
        </div>

        {/* Separator */}
        <div className="my-2 h-px bg-border" />

        {/* Channels section */}
        <div>
          <Skeleton className="mb-2 h-3 w-16 px-2" />
          <div className="space-y-1">
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="h-8 w-full rounded-md" />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Stream content skeleton matching the structure of stream pages.
 * Used during coordinated loading for the main content area.
 */
export function StreamContentSkeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex h-14 items-center justify-between border-b px-4">
        <Skeleton className="h-6 w-40" />
        <div className="flex items-center gap-1">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </header>

      {/* Messages area */}
      <div className="flex-1 overflow-hidden p-4">
        <div className="space-y-4">
          <MessageSkeleton />
          <MessageSkeleton />
          <MessageSkeleton />
          <MessageSkeleton />
        </div>
      </div>

      {/* Composer area */}
      <div className="border-t p-4">
        <Skeleton className="h-24 w-full rounded-md" />
      </div>
    </div>
  )
}

function MessageSkeleton() {
  return (
    <div className="flex gap-3">
      {/* Avatar */}
      <Skeleton className="h-9 w-9 flex-shrink-0 rounded-full" />

      {/* Content */}
      <div className="flex-1 space-y-2">
        {/* Header row */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-12" />
        </div>

        {/* Message content */}
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  )
}
