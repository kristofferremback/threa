export { api, ApiError } from "./client"
export { workspacesApi, type WorkspaceBootstrap } from "./workspaces"
export { streamsApi, type StreamBootstrap, type CreateStreamInput, type UpdateStreamInput } from "./streams"
export { messagesApi, type CreateMessageInput, type UpdateMessageInput } from "./messages"
export { attachmentsApi } from "./attachments"
export {
  commandsApi,
  type DispatchCommandInput,
  type DispatchCommandResponse,
  type DispatchCommandError,
  type DispatchResult,
  type CommandInfo,
} from "./commands"
export {
  searchMessages,
  type SearchFilters,
  type SearchRequest,
  type SearchResultItem,
  type SearchResponse,
  type ArchiveStatus,
} from "./search"
export { conversationsApi, type ListConversationsParams } from "./conversations"
export { preferencesApi } from "./preferences"
export { aiUsageApi } from "./ai-usage"
export { agentSessionsApi } from "./agent-sessions"
