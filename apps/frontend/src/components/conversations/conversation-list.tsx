import { useSearchParams } from "react-router-dom"
import { cn } from "@/lib/utils"
import { useConversations } from "@/hooks"
import { ConversationItem } from "./conversation-item"
import { Skeleton } from "@/components/ui/skeleton"
import type { ConversationWithStaleness } from "@threa/types"

interface ConversationListProps {
  workspaceId: string
  streamId: string
  className?: string
  onMessageClick?: () => void
}

export function ConversationList({ workspaceId, streamId, className, onMessageClick }: ConversationListProps) {
  const { conversations, isLoading, error } = useConversations(workspaceId, streamId)
  const [searchParams, setSearchParams] = useSearchParams()

  const expandedConversationId = searchParams.get("conv")

  const handleToggle = (conversationId: string) => {
    setSearchParams((prev) => {
      const newParams = new URLSearchParams(prev)
      if (expandedConversationId === conversationId) {
        newParams.delete("conv")
      } else {
        newParams.set("conv", conversationId)
      }
      return newParams
    })
  }

  if (error) {
    return <div className={cn("p-4 text-sm text-destructive", className)}>Failed to load conversations</div>
  }

  if (isLoading) {
    return (
      <div className={cn("space-y-2 p-2", className)}>
        <ConversationSkeleton />
        <ConversationSkeleton />
        <ConversationSkeleton />
      </div>
    )
  }

  if (conversations.length === 0) {
    return <div className={cn("p-4 text-sm text-muted-foreground text-center", className)}>No conversations yet</div>
  }

  const activeConversations = conversations.filter((c) => c.status === "active")
  const stalledConversations = conversations.filter((c) => c.status === "stalled")
  const resolvedConversations = conversations.filter((c) => c.status === "resolved")

  return (
    <div className={cn("space-y-4 p-2", className)}>
      {activeConversations.length > 0 && (
        <ConversationSection
          title="Active"
          workspaceId={workspaceId}
          conversations={activeConversations}
          expandedConversationId={expandedConversationId}
          onToggle={handleToggle}
          onMessageClick={onMessageClick}
        />
      )}
      {stalledConversations.length > 0 && (
        <ConversationSection
          title="Stalled"
          workspaceId={workspaceId}
          conversations={stalledConversations}
          expandedConversationId={expandedConversationId}
          onToggle={handleToggle}
          onMessageClick={onMessageClick}
        />
      )}
      {resolvedConversations.length > 0 && (
        <ConversationSection
          title="Resolved"
          workspaceId={workspaceId}
          conversations={resolvedConversations}
          expandedConversationId={expandedConversationId}
          onToggle={handleToggle}
          onMessageClick={onMessageClick}
        />
      )}
    </div>
  )
}

interface ConversationSectionProps {
  title: string
  workspaceId: string
  conversations: ConversationWithStaleness[]
  expandedConversationId: string | null
  onToggle: (conversationId: string) => void
  onMessageClick?: () => void
}

function ConversationSection({
  title,
  workspaceId,
  conversations,
  expandedConversationId,
  onToggle,
  onMessageClick,
}: ConversationSectionProps) {
  return (
    <div>
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1 mb-2">
        {title} ({conversations.length})
      </h3>
      <div className="space-y-1">
        {conversations.map((conversation) => (
          <ConversationItem
            key={conversation.id}
            workspaceId={workspaceId}
            conversation={conversation}
            isExpanded={expandedConversationId === conversation.id}
            onToggle={() => onToggle(conversation.id)}
            onMessageClick={onMessageClick}
          />
        ))}
      </div>
    </div>
  )
}

function ConversationSkeleton() {
  return (
    <div className="p-3 rounded-lg border bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <div className="flex flex-col items-end gap-1">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
    </div>
  )
}
