import { AgentToolNames } from "@threa/types"
import type { AgentTool } from "../runtime"
import type { WorkspaceAgentResult } from "../researcher"
import type { WorkspaceToolDeps } from "../tools/tool-deps"
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
} from "../tools"

export interface ToolSetConfig {
  enabledTools: string[] | null
  tavilyApiKey?: string
  runWorkspaceAgent?: (query: string) => Promise<WorkspaceAgentResult>
  workspace?: WorkspaceToolDeps
  supportsVision?: boolean
}

/**
 * Build the complete tool set for a companion agent session.
 * Each tool receives its dependencies at construction time.
 * Returns AgentTool[] — send_message is NOT included (the runtime handles it).
 */
export function buildToolSet(config: ToolSetConfig): AgentTool[] {
  const { enabledTools, tavilyApiKey, runWorkspaceAgent, workspace, supportsVision } = config

  const tools: Array<AgentTool | null> = [
    // Workspace research (available when agent has trigger context)
    runWorkspaceAgent ? createWorkspaceResearchTool({ runWorkspaceAgent }) : null,

    // Web tools
    tavilyApiKey && isToolEnabled(enabledTools, AgentToolNames.WEB_SEARCH)
      ? createWebSearchTool({ tavilyApiKey })
      : null,
    isToolEnabled(enabledTools, AgentToolNames.READ_URL) ? createReadUrlTool() : null,

    // Workspace search tools
    workspace && isToolEnabled(enabledTools, AgentToolNames.SEARCH_MESSAGES)
      ? createSearchMessagesTool(workspace)
      : null,
    workspace && isToolEnabled(enabledTools, AgentToolNames.SEARCH_STREAMS) ? createSearchStreamsTool(workspace) : null,
    workspace && isToolEnabled(enabledTools, AgentToolNames.SEARCH_USERS) ? createSearchUsersTool(workspace) : null,
    workspace && isToolEnabled(enabledTools, AgentToolNames.GET_STREAM_MESSAGES)
      ? createGetStreamMessagesTool(workspace)
      : null,

    // Attachment tools
    workspace && isToolEnabled(enabledTools, AgentToolNames.SEARCH_ATTACHMENTS)
      ? createSearchAttachmentsTool(workspace)
      : null,
    workspace && isToolEnabled(enabledTools, AgentToolNames.GET_ATTACHMENT) ? createGetAttachmentTool(workspace) : null,
    workspace && supportsVision && isToolEnabled(enabledTools, AgentToolNames.LOAD_ATTACHMENT)
      ? createLoadAttachmentTool(workspace)
      : null,
    workspace && isToolEnabled(enabledTools, AgentToolNames.LOAD_PDF_SECTION)
      ? createLoadPdfSectionTool(workspace)
      : null,
    workspace && isToolEnabled(enabledTools, AgentToolNames.LOAD_FILE_SECTION)
      ? createLoadFileSectionTool(workspace)
      : null,
    workspace && isToolEnabled(enabledTools, AgentToolNames.LOAD_EXCEL_SECTION)
      ? createLoadExcelSectionTool(workspace)
      : null,
  ]

  return tools.filter((t): t is AgentTool => t !== null)
}
