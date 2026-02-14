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
  const tools: AgentTool[] = []

  if (runWorkspaceAgent) {
    tools.push(createWorkspaceResearchTool({ runWorkspaceAgent }))
  }

  if (tavilyApiKey && isToolEnabled(enabledTools, AgentToolNames.WEB_SEARCH)) {
    tools.push(createWebSearchTool({ tavilyApiKey }))
  }

  if (isToolEnabled(enabledTools, AgentToolNames.READ_URL)) {
    tools.push(createReadUrlTool())
  }

  if (search) {
    if (isToolEnabled(enabledTools, AgentToolNames.SEARCH_MESSAGES)) {
      tools.push(createSearchMessagesTool(search))
    }
    if (isToolEnabled(enabledTools, AgentToolNames.SEARCH_STREAMS)) {
      tools.push(createSearchStreamsTool(search))
    }
    if (isToolEnabled(enabledTools, AgentToolNames.SEARCH_USERS)) {
      tools.push(createSearchUsersTool(search))
    }
    if (isToolEnabled(enabledTools, AgentToolNames.GET_STREAM_MESSAGES)) {
      tools.push(createGetStreamMessagesTool(search))
    }
  }

  if (attachments) {
    if (isToolEnabled(enabledTools, AgentToolNames.SEARCH_ATTACHMENTS)) {
      tools.push(createSearchAttachmentsTool(attachments.search))
    }
    if (isToolEnabled(enabledTools, AgentToolNames.GET_ATTACHMENT)) {
      tools.push(createGetAttachmentTool(attachments.get))
    }
    if (attachments.load && isToolEnabled(enabledTools, AgentToolNames.LOAD_ATTACHMENT)) {
      tools.push(createLoadAttachmentTool(attachments.load))
    }
    if (attachments.loadPdfSection && isToolEnabled(enabledTools, AgentToolNames.LOAD_PDF_SECTION)) {
      tools.push(createLoadPdfSectionTool(attachments.loadPdfSection))
    }
    if (attachments.loadFileSection && isToolEnabled(enabledTools, AgentToolNames.LOAD_FILE_SECTION)) {
      tools.push(createLoadFileSectionTool(attachments.loadFileSection))
    }
    if (attachments.loadExcelSection && isToolEnabled(enabledTools, AgentToolNames.LOAD_EXCEL_SECTION)) {
      tools.push(createLoadExcelSectionTool(attachments.loadExcelSection))
    }
  }

  return tools
}
