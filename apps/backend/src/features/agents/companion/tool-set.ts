import { AgentToolNames } from "@threa/types"
import type { AgentTool } from "../runtime"
import {
  createWebSearchTool,
  createReadUrlTool,
  createSearchMessagesTool,
  createSearchStreamsTool,
  createSearchUsersTool,
  createGetStreamMessagesTool,
  createSearchAttachmentsTool,
  createGetAttachmentTool,
  createLoadAttachmentTool,
  createLoadPdfSectionTool,
  createLoadFileSectionTool,
  createLoadExcelSectionTool,
  createWorkspaceResearchTool,
  isToolEnabled,
  type SearchToolsCallbacks,
  type SearchAttachmentsCallbacks,
  type GetAttachmentCallbacks,
  type LoadAttachmentCallbacks,
  type LoadPdfSectionCallbacks,
  type LoadFileSectionCallbacks,
  type LoadExcelSectionCallbacks,
  type WorkspaceResearchCallbacks,
} from "../tools"

export interface ToolSetConfig {
  enabledTools: string[] | null
  tavilyApiKey?: string
  runWorkspaceAgent?: WorkspaceResearchCallbacks["runWorkspaceAgent"]
  search?: SearchToolsCallbacks
  attachments?: {
    search: SearchAttachmentsCallbacks
    get: GetAttachmentCallbacks
    load?: LoadAttachmentCallbacks
    loadPdfSection?: LoadPdfSectionCallbacks
    loadFileSection?: LoadFileSectionCallbacks
    loadExcelSection?: LoadExcelSectionCallbacks
  }
}

/**
 * Build the complete tool set for a companion agent session.
 * Each tool receives its dependencies at construction time.
 * Returns AgentTool[] — send_message is NOT included (the runtime handles it).
 */
export function buildToolSet(config: ToolSetConfig): AgentTool[] {
  const { enabledTools, tavilyApiKey, runWorkspaceAgent, search, attachments } = config

  const tools: Array<AgentTool | null> = [
    // Workspace research (available when agent has trigger context)
    runWorkspaceAgent ? createWorkspaceResearchTool({ runWorkspaceAgent }) : null,

    // Web tools
    tavilyApiKey && isToolEnabled(enabledTools, AgentToolNames.WEB_SEARCH)
      ? createWebSearchTool({ tavilyApiKey })
      : null,
    isToolEnabled(enabledTools, AgentToolNames.READ_URL) ? createReadUrlTool() : null,

    // Workspace search tools
    search && isToolEnabled(enabledTools, AgentToolNames.SEARCH_MESSAGES) ? createSearchMessagesTool(search) : null,
    search && isToolEnabled(enabledTools, AgentToolNames.SEARCH_STREAMS) ? createSearchStreamsTool(search) : null,
    search && isToolEnabled(enabledTools, AgentToolNames.SEARCH_USERS) ? createSearchUsersTool(search) : null,
    search && isToolEnabled(enabledTools, AgentToolNames.GET_STREAM_MESSAGES)
      ? createGetStreamMessagesTool(search)
      : null,

    // Attachment tools
    attachments && isToolEnabled(enabledTools, AgentToolNames.SEARCH_ATTACHMENTS)
      ? createSearchAttachmentsTool(attachments.search)
      : null,
    attachments && isToolEnabled(enabledTools, AgentToolNames.GET_ATTACHMENT)
      ? createGetAttachmentTool(attachments.get)
      : null,
    attachments?.load && isToolEnabled(enabledTools, AgentToolNames.LOAD_ATTACHMENT)
      ? createLoadAttachmentTool(attachments.load)
      : null,
    attachments?.loadPdfSection && isToolEnabled(enabledTools, AgentToolNames.LOAD_PDF_SECTION)
      ? createLoadPdfSectionTool(attachments.loadPdfSection)
      : null,
    attachments?.loadFileSection && isToolEnabled(enabledTools, AgentToolNames.LOAD_FILE_SECTION)
      ? createLoadFileSectionTool(attachments.loadFileSection)
      : null,
    attachments?.loadExcelSection && isToolEnabled(enabledTools, AgentToolNames.LOAD_EXCEL_SECTION)
      ? createLoadExcelSectionTool(attachments.loadExcelSection)
      : null,
  ]

  return tools.filter((t): t is AgentTool => t !== null)
}
