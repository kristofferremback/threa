import { Bell } from "lucide-react"

interface ActivityEmptyProps {
  isFiltered: boolean
}

export function ActivityEmpty({ isFiltered }: ActivityEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
        <Bell className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">{isFiltered ? "No unread activity" : "No activity yet"}</p>
      <p className="text-xs text-muted-foreground/60 mt-1">
        {isFiltered ? "You're all caught up!" : "When someone @mentions you, it'll show up here"}
      </p>
    </div>
  )
}
