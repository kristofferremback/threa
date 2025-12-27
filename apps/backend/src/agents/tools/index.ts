export { createSendMessageTool, type SendMessageInput, type SendMessageResult } from "./send-message-tool"
export { createWebSearchTool, type WebSearchInput, type WebSearchResult } from "./web-search-tool"
export { createReadUrlTool, type ReadUrlInput, type ReadUrlResult } from "./read-url-tool"

/**
 * Check if a tool is enabled for a persona.
 * If enabledTools is null, all tools are enabled (backwards compatible default).
 */
export function isToolEnabled(enabledTools: string[] | null, toolName: string): boolean {
  if (enabledTools === null) return true
  return enabledTools.includes(toolName)
}
