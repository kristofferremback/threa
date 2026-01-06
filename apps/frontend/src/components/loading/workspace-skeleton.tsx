import { Skeleton } from "@/components/ui/skeleton"

interface WorkspaceSkeletonProps {
  animated?: boolean
}

/**
 * Full workspace skeleton showing sidebar + main content area structure.
 * Used during coordinated loading to show loading state.
 */
export function WorkspaceSkeleton({ animated = true }: WorkspaceSkeletonProps) {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Sidebar skeleton */}
      <aside className="flex h-full w-64 flex-shrink-0 flex-col border-r bg-muted/30">
        <SidebarSkeleton animated={animated} />
      </aside>

      {/* Main content skeleton */}
      <main className="flex h-full flex-1 flex-col overflow-hidden">
        <StreamContentSkeleton animated={animated} />
      </main>
    </div>
  )
}

function SidebarSkeleton({ animated }: { animated: boolean }) {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b px-4">
        <Skeleton animated={animated} className="h-5 w-32" />
        <div className="flex items-center gap-1">
          <Skeleton animated={animated} className="h-8 w-8 rounded-md" />
          <Skeleton animated={animated} className="h-8 w-8 rounded-md" />
        </div>
      </div>

      {/* Drafts link */}
      <div className="border-b px-2 py-2">
        <Skeleton animated={animated} className="h-9 w-full rounded-md" />
      </div>

      {/* Stream list */}
      <div className="flex-1 overflow-hidden p-2">
        {/* Scratchpads section */}
        <div className="mb-4">
          <Skeleton animated={animated} className="mb-2 h-3 w-20 px-2" />
          <div className="space-y-1">
            <Skeleton animated={animated} className="h-8 w-full rounded-md" />
            <Skeleton animated={animated} className="h-8 w-full rounded-md" />
            <Skeleton animated={animated} className="h-8 w-full rounded-md" />
          </div>
        </div>

        {/* Separator */}
        <div className="my-2 h-px bg-border" />

        {/* Channels section */}
        <div>
          <Skeleton animated={animated} className="mb-2 h-3 w-16 px-2" />
          <div className="space-y-1">
            <Skeleton animated={animated} className="h-8 w-full rounded-md" />
            <Skeleton animated={animated} className="h-8 w-full rounded-md" />
          </div>
        </div>
      </div>
    </div>
  )
}

function StreamContentSkeleton({ animated }: { animated: boolean }) {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex h-14 items-center justify-between border-b px-4">
        <Skeleton animated={animated} className="h-6 w-40" />
        <div className="flex items-center gap-1">
          <Skeleton animated={animated} className="h-8 w-8 rounded-md" />
          <Skeleton animated={animated} className="h-8 w-8 rounded-md" />
        </div>
      </header>

      {/* Messages area */}
      <div className="flex-1 overflow-hidden p-4">
        <div className="space-y-4">
          <MessageSkeleton animated={animated} />
          <MessageSkeleton animated={animated} />
          <MessageSkeleton animated={animated} />
          <MessageSkeleton animated={animated} />
        </div>
      </div>

      {/* Composer area */}
      <div className="border-t p-4">
        <Skeleton animated={animated} className="h-24 w-full rounded-md" />
      </div>
    </div>
  )
}

function MessageSkeleton({ animated }: { animated: boolean }) {
  return (
    <div className="flex gap-3">
      {/* Avatar */}
      <Skeleton animated={animated} className="h-9 w-9 flex-shrink-0 rounded-full" />

      {/* Content */}
      <div className="flex-1 space-y-2">
        {/* Header row */}
        <div className="flex items-center gap-2">
          <Skeleton animated={animated} className="h-4 w-24" />
          <Skeleton animated={animated} className="h-3 w-12" />
        </div>

        {/* Message content */}
        <Skeleton animated={animated} className="h-4 w-full" />
        <Skeleton animated={animated} className="h-4 w-3/4" />
      </div>
    </div>
  )
}
