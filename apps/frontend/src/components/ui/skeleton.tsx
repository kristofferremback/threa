import { cn } from "@/lib/utils"

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  animated?: boolean
}

function Skeleton({ className, animated = true, ...props }: SkeletonProps) {
  return <div className={cn("rounded-md bg-muted", animated && "animate-pulse", className)} {...props} />
}

export { Skeleton }
