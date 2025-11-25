import { AlertCircle } from "lucide-react"

interface ConnectionErrorProps {
  message: string
}

export function ConnectionError({ message }: ConnectionErrorProps) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center max-w-md px-4">
        <AlertCircle className="h-12 w-12 mx-auto mb-4" style={{ color: "var(--text-muted)" }} />
        <h3 className="text-lg font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>
          Connection Error
        </h3>
        <p
          className="text-sm mb-2 p-2 rounded"
          style={{
            background: "var(--bg-tertiary)",
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {message}
        </p>
      </div>
    </div>
  )
}

