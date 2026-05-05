import { Skeleton } from "@/components/ui/skeleton"

export function ScheduledSkeleton() {
  return (
    <div className="flex flex-col gap-px">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 border-b px-4 py-3">
          <Skeleton className="h-4 w-16 rounded" />
          <div className="flex-1 min-w-0 space-y-2">
            <Skeleton className="h-4 w-full max-w-md" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-7 w-20 rounded" />
        </div>
      ))}
    </div>
  )
}
