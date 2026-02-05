export {
  createSendMessageTool,
  type SendMessageInput,
  type SendMessageInputWithSources,
  type SendMessageResult,
} from "./send-message-tool"
export { createWebSearchTool, type WebSearchInput, type WebSearchResult } from "./web-search-tool"
export { createReadUrlTool, type ReadUrlInput, type ReadUrlResult } from "./read-url-tool"
export {
  createSearchMessagesTool,
  createSearchStreamsTool,
  createSearchUsersTool,
  createGetStreamMessagesTool,
  type SearchMessagesInput,
  type SearchStreamsInput,
  type SearchUsersInput,
  type GetStreamMessagesInput,
  type SearchToolsCallbacks,
  type MessageSearchResult,
  type StreamSearchResult,
  type UserSearchResult,
  type StreamMessagesResult,
} from "./search-workspace-tool"
export {
  createSearchAttachmentsTool,
  type SearchAttachmentsInput,
  type SearchAttachmentsCallbacks,
  type AttachmentSearchResult,
} from "./search-attachments-tool"
export {
  createGetAttachmentTool,
  type GetAttachmentInput,
  type GetAttachmentCallbacks,
  type AttachmentDetails,
} from "./get-attachment-tool"
export {
  createLoadAttachmentTool,
  isMultimodalToolResult,
  type LoadAttachmentInput,
  type LoadAttachmentCallbacks,
  type LoadAttachmentResult,
  type MultimodalToolResult,
} from "./load-attachment-tool"
export {
  createLoadPdfSectionTool,
  type LoadPdfSectionInput,
  type LoadPdfSectionCallbacks,
  type LoadPdfSectionResult,
} from "./load-pdf-section-tool"
export {
  createLoadFileSectionTool,
  type LoadFileSectionInput,
  type LoadFileSectionCallbacks,
  type LoadFileSectionResult,
} from "./load-file-section-tool"

/**
 * Check if a tool is enabled for a persona.
 * If enabledTools is null, all tools are enabled (backwards compatible default).
 */
export function isToolEnabled(enabledTools: string[] | null, toolName: string): boolean {
  if (enabledTools === null) return true
  return enabledTools.includes(toolName)
}
