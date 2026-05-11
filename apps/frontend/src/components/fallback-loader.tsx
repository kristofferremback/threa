import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"

const DELAY_MS = 300

export function FallbackLoader() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setShow(true), DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  if (!show) return null

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}
