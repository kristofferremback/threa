import { Skeleton } from "@/components/ui/skeleton"

export function HeaderSkeleton() {
  return (
    <div className="flex-shrink-0 border-b px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <Skeleton className="h-4 w-24" />
        <div className="flex items-center gap-1">
          <Skeleton className="h-7 w-7 rounded-md" />
          <Skeleton className="h-7 w-7 rounded-md" />
        </div>
      </div>
      <Skeleton className="h-9 w-full rounded-lg" />
      <div className="flex items-center gap-2 mt-3">
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
