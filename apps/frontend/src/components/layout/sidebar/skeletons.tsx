import { Skeleton } from "@/components/ui/skeleton"

export function HeaderSkeleton() {
  return (
    <div className="flex-shrink-0 border-b">
      {/* Matches the new h-12 top row: toggle + logo + name + theme dropdown */}
      <div className="flex h-12 items-center gap-1 px-4">
        <Skeleton className="h-8 w-8 rounded-md" />
        <Skeleton className="ml-1 h-4 w-24" />
        <Skeleton className="ml-auto h-7 w-7 rounded-md" />
      </div>
      {/* Matches the three quick-action pills */}
      <div className="flex items-center gap-1 px-3 pt-2">
        <Skeleton className="h-8 flex-1 rounded-md" />
        <Skeleton className="h-8 flex-1 rounded-md" />
        <Skeleton className="h-8 flex-1 rounded-md" />
      </div>
      <div className="flex items-center gap-2 px-3 pb-3 pt-2">
        <Skeleton className="h-7 w-24 rounded-md" />
      </div>
    </div>
  )
}

export function QuickLinksSkeleton() {
  return (
    <div className="space-y-1">
      <Skeleton className="h-9 w-full rounded-md" />
      <Skeleton className="h-9 w-full rounded-md" />
    </div>
  )
}

export function StreamListSkeleton() {
  return (
    <div className="flex-1 p-2">
      <div className="mb-4">
        <Skeleton className="mb-2 h-6 w-28 px-3" />
        <div className="space-y-1">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </div>
      <div>
        <Skeleton className="mb-2 h-6 w-20 px-3" />
        <div className="space-y-1">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </div>
    </div>
  )
}
