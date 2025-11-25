import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

interface EmptyStateProps {
  icon: LucideIcon
  title?: string
  description: string
  action?: ReactNode
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center max-w-md px-4">
        <Icon className="h-12 w-12 mx-auto mb-4 opacity-50" style={{ color: "var(--text-muted)" }} />
        {title && (
          <h3 className="text-lg font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
            {title}
          </h3>
        )}
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {description}
        </p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  )
}


