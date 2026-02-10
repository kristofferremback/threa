import { useState } from "react"
import { Hash } from "lucide-react"
import { Button } from "@/components/ui/button"
import { streamsApi } from "@/api"
import type { StreamMember } from "@threa/types"

interface JoinChannelBarProps {
  workspaceId: string
  streamId: string
  channelName: string
  onJoined: (membership: StreamMember) => void
}

export function JoinChannelBar({ workspaceId, streamId, channelName, onJoined }: JoinChannelBarProps) {
  const [isJoining, setIsJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleJoin = async () => {
    setIsJoining(true)
    setError(null)
    try {
      const membership = await streamsApi.join(workspaceId, streamId)
      onJoined(membership)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to join channel")
    } finally {
      setIsJoining(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-3 border-t px-4 py-6">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>You're viewing</span>
        <span className="inline-flex items-center gap-0.5 font-medium text-foreground">
          <Hash className="h-3.5 w-3.5" />
          {channelName}
        </span>
      </div>
      <Button onClick={handleJoin} disabled={isJoining} size="sm">
        {isJoining ? "Joining..." : "Join Channel"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
