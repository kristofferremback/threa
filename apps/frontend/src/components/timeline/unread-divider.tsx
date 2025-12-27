interface UnreadDividerProps {
  isFading?: boolean
}

export function UnreadDivider({ isFading }: UnreadDividerProps) {
  return (
    <div
      className={`absolute left-0 right-0 top-0 -translate-y-1/2 z-10 flex items-center gap-3 pointer-events-none transition-opacity duration-500 ${
        isFading ? "opacity-0" : "opacity-100"
      }`}
    >
      <div className="flex-1 border-t border-destructive" />
      <span className="text-xs font-medium text-destructive bg-background px-2">New</span>
      <div className="flex-1 border-t border-destructive" />
    </div>
  )
}
