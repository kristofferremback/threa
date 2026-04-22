import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { InviteCommand } from "./invite-command"
import { StreamRepository } from "../streams"
import { UserRepository } from "../workspaces"
import { BotRepository } from "../public-api"
import * as authzResolver from "../../middleware/workspace-authz-resolver"
import { StreamTypes } from "@threa/types"

describe("InviteCommand", () => {
  const findStreamById = spyOn(StreamRepository, "findById")
  const findUsersBySlugs = spyOn(UserRepository, "findBySlugs")
  const findUserById = spyOn(UserRepository, "findById")
  const findBotsBySlugs = spyOn(BotRepository, "findBySlugs")
  const resolveWorkspaceAuthorization = spyOn(authzResolver, "resolveWorkspaceAuthorization")

  beforeEach(() => {
    findStreamById.mockReset()
    findUsersBySlugs.mockReset()
    findUserById.mockReset()
    findBotsBySlugs.mockReset()
    resolveWorkspaceAuthorization.mockReset()
  })

  test("requires workspace:admin permission to invite bots", async () => {
    const pool = {} as never
    findStreamById.mockResolvedValue({
      id: "stream_1",
      workspaceId: "ws_1",
      type: StreamTypes.CHANNEL,
    } as never)
    findUsersBySlugs.mockResolvedValue([] as never)
    findBotsBySlugs.mockResolvedValue([{ id: "bot_1", slug: "helper", name: "Helper Bot" }] as never)
    findUserById.mockResolvedValue({
      id: "user_1",
      workspaceId: "ws_1",
      workosUserId: "wos_1",
      role: "user",
    } as never)
    resolveWorkspaceAuthorization.mockResolvedValue({
      status: "ok",
      value: {
        source: "user_api_key",
        organizationId: "org_1",
        organizationMembershipId: "om_1",
        permissions: new Set(["messages:read"]),
        assignedRoles: [{ slug: "member", name: "Member" }],
        canEditRole: true,
        compatibilityRole: "user",
        isOwner: false,
      },
    } as never)

    const streamService = {
      addMember: mock(async () => undefined),
      addBotToStream: mock(async () => undefined),
    } as any

    const command = new InviteCommand({ pool, streamService })
    const result = await command.execute({
      commandId: "cmd_1",
      commandName: "invite",
      workspaceId: "ws_1",
      streamId: "stream_1",
      userId: "user_1",
      args: "@helper",
    })

    expect(result).toEqual({
      success: false,
      error: "Missing required permission: workspace:admin",
    })
    expect(resolveWorkspaceAuthorization).toHaveBeenCalledWith({
      pool,
      workspaceId: "ws_1",
      userId: "user_1",
      source: "user_api_key",
      workosUserId: "wos_1",
    })
    expect(streamService.addBotToStream).not.toHaveBeenCalled()
  })

  test("allows bot invites when workspace:admin is granted", async () => {
    const pool = {} as never
    findStreamById.mockResolvedValue({
      id: "stream_1",
      workspaceId: "ws_1",
      type: StreamTypes.CHANNEL,
    } as never)
    findUsersBySlugs.mockResolvedValue([] as never)
    findBotsBySlugs.mockResolvedValue([{ id: "bot_1", slug: "helper", name: "Helper Bot" }] as never)
    findUserById.mockResolvedValue({
      id: "user_1",
      workspaceId: "ws_1",
      workosUserId: "wos_1",
      role: "admin",
    } as never)
    resolveWorkspaceAuthorization.mockResolvedValue({
      status: "ok",
      value: {
        source: "user_api_key",
        organizationId: "org_1",
        organizationMembershipId: "om_1",
        permissions: new Set(["workspace:admin"]),
        assignedRoles: [{ slug: "admin", name: "Admin" }],
        canEditRole: true,
        compatibilityRole: "admin",
        isOwner: false,
      },
    } as never)

    const streamService = {
      addMember: mock(async () => undefined),
      addBotToStream: mock(async () => undefined),
    } as any

    const command = new InviteCommand({ pool, streamService })
    const result = await command.execute({
      commandId: "cmd_1",
      commandName: "invite",
      workspaceId: "ws_1",
      streamId: "stream_1",
      userId: "user_1",
      args: "@helper",
    })

    expect(result).toEqual({
      success: true,
      result: {
        invited: [{ name: "Helper Bot", slug: "helper", type: "bot" }],
      },
    })
    expect(streamService.addBotToStream).toHaveBeenCalledWith("stream_1", "bot_1", "ws_1", "user_1")
  })
})
