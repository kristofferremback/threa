import { Loader2 } from "lucide-react"
import { clsx } from "clsx"

interface SpinnerProps {
  size?: "sm" | "md" | "lg"
  className?: string
}

const sizeClasses = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
}

export function Spinner({ size = "md", className }: SpinnerProps) {
  return (
    <Loader2
      className={clsx("animate-spin", sizeClasses[size], className)}
      style={{ color: "var(--accent-primary)" }}
    />
  )
}

interface LoadingStateProps {
  message?: string
}

export function LoadingState({ message = "Loading..." }: LoadingStateProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <Spinner size="lg" className="mx-auto mb-3" />
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {message}
        </p>
      </div>
    </div>
  )
}


