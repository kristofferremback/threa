import { Button } from "../../ui"

interface ErrorScreenProps {
  message: string
  onRetry?: () => void
}

export function ErrorScreen({ message, onRetry }: ErrorScreenProps) {
  return (
    <div className="flex h-screen w-full items-center justify-center" style={{ background: "var(--gradient-bg)" }}>
      <div className="text-center max-w-md px-6">
        <p style={{ color: "var(--danger)" }}>{message}</p>
        {onRetry && (
          <Button variant="secondary" onClick={onRetry} className="mt-4">
            Retry
          </Button>
        )}
      </div>
    </div>
  )
}

