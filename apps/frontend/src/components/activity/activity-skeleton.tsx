import { Skeleton } from "@/components/ui/skeleton"

export function ActivitySkeleton() {
  return (
    <div className="flex flex-col gap-2 px-4 py-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 py-3">
          <Skeleton className="h-2 w-2 rounded-full mt-2" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}
