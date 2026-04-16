export function SavedSkeleton() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3 border-b border-border/50 animate-pulse">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="h-3.5 bg-muted rounded w-2/5" />
            <div className="h-3 bg-muted/60 rounded w-4/5" />
            <div className="h-2.5 bg-muted/40 rounded w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}
