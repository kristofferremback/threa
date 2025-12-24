import { useEffect } from "react"
import { useParams, useSearchParams } from "react-router-dom"
import { StreamContent } from "./stream-content"

interface TimelineViewProps {
  isDraft?: boolean
}

export function TimelineView({ isDraft = false }: TimelineViewProps) {
  const { workspaceId, streamId } = useParams<{ workspaceId: string; streamId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const highlightMessageId = searchParams.get("m")

  // Clear the message param after a delay to allow highlighting
  useEffect(() => {
    if (highlightMessageId) {
      const timer = setTimeout(() => {
        setSearchParams(
          (prev) => {
            prev.delete("m")
            return prev
          },
          { replace: true }
        )
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [highlightMessageId, setSearchParams])

  if (!workspaceId || !streamId) {
    return null
  }

  return (
    <StreamContent
      workspaceId={workspaceId}
      streamId={streamId}
      highlightMessageId={highlightMessageId}
      isDraft={isDraft}
    />
  )
}
