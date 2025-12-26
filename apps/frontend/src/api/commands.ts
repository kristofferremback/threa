import { api } from "./client"
import type { DispatchCommandInput, DispatchCommandResponse, DispatchCommandError, CommandInfo } from "@threa/types"

export type { DispatchCommandInput, DispatchCommandResponse, DispatchCommandError, CommandInfo }

export type DispatchResult = DispatchCommandResponse | DispatchCommandError

export const commandsApi = {
  async dispatch(workspaceId: string, data: DispatchCommandInput): Promise<DispatchResult> {
    const res = await api.post<DispatchResult>(`/api/workspaces/${workspaceId}/commands/dispatch`, data)
    return res
  },

  async list(workspaceId: string): Promise<CommandInfo[]> {
    const res = await api.get<{ commands: CommandInfo[] }>(`/api/workspaces/${workspaceId}/commands`)
    return res.commands
  },
}
