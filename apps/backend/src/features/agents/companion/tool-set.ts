import type { Tool } from "ai"
import { AgentToolNames } from "@threa/types"
import {
  createSendMessageTool,
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
  runResearcher?: WorkspaceResearchCallbacks["runResearcher"]
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
 * The send_message tool has no execute handler — the agent loop intercepts it.
 */
export function buildToolSet(config: ToolSetConfig): Record<string, Tool<any, any>> {
  const { enabledTools, tavilyApiKey, runResearcher, search, attachments } = config
  const tools: Record<string, Tool<any, any>> = {}

  tools[AgentToolNames.SEND_MESSAGE] = createSendMessageTool()

  if (runResearcher) {
    tools["workspace_research"] = createWorkspaceResearchTool({ runResearcher })
  }

  if (tavilyApiKey && isToolEnabled(enabledTools, AgentToolNames.WEB_SEARCH)) {
    tools[AgentToolNames.WEB_SEARCH] = createWebSearchTool({ tavilyApiKey })
  }

  if (isToolEnabled(enabledTools, AgentToolNames.READ_URL)) {
    tools[AgentToolNames.READ_URL] = createReadUrlTool()
  }

  if (search) {
    if (isToolEnabled(enabledTools, AgentToolNames.SEARCH_MESSAGES)) {
      tools[AgentToolNames.SEARCH_MESSAGES] = createSearchMessagesTool(search)
    }
    if (isToolEnabled(enabledTools, AgentToolNames.SEARCH_STREAMS)) {
      tools[AgentToolNames.SEARCH_STREAMS] = createSearchStreamsTool(search)
    }
    if (isToolEnabled(enabledTools, AgentToolNames.SEARCH_USERS)) {
      tools[AgentToolNames.SEARCH_USERS] = createSearchUsersTool(search)
    }
    if (isToolEnabled(enabledTools, AgentToolNames.GET_STREAM_MESSAGES)) {
      tools[AgentToolNames.GET_STREAM_MESSAGES] = createGetStreamMessagesTool(search)
    }
  }

  if (attachments) {
    if (isToolEnabled(enabledTools, AgentToolNames.SEARCH_ATTACHMENTS)) {
      tools[AgentToolNames.SEARCH_ATTACHMENTS] = createSearchAttachmentsTool(attachments.search)
    }
    if (isToolEnabled(enabledTools, AgentToolNames.GET_ATTACHMENT)) {
      tools[AgentToolNames.GET_ATTACHMENT] = createGetAttachmentTool(attachments.get)
    }
    if (attachments.load && isToolEnabled(enabledTools, AgentToolNames.LOAD_ATTACHMENT)) {
      tools[AgentToolNames.LOAD_ATTACHMENT] = createLoadAttachmentTool(attachments.load)
    }
    if (attachments.loadPdfSection && isToolEnabled(enabledTools, AgentToolNames.LOAD_PDF_SECTION)) {
      tools[AgentToolNames.LOAD_PDF_SECTION] = createLoadPdfSectionTool(attachments.loadPdfSection)
    }
    if (attachments.loadFileSection && isToolEnabled(enabledTools, AgentToolNames.LOAD_FILE_SECTION)) {
      tools[AgentToolNames.LOAD_FILE_SECTION] = createLoadFileSectionTool(attachments.loadFileSection)
    }
    if (attachments.loadExcelSection && isToolEnabled(enabledTools, AgentToolNames.LOAD_EXCEL_SECTION)) {
      tools[AgentToolNames.LOAD_EXCEL_SECTION] = createLoadExcelSectionTool(attachments.loadExcelSection)
    }
  }

  return tools
}
