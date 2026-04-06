import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { AuthorTypes, CompanionModes, NotificationLevels, StreamTypes, Visibilities } from "@threa/types"
import { ActivityService } from "./service"
import { ActivityRepository } from "./repository"
import { UserRepository } from "../workspaces"
import { StreamRepository, StreamMemberRepository, resolveNotificationLevelsForStream } from "../streams"
import { PersonaRepository } from "../agents"
import { BotRepository } from "../public-api"
import * as dbModule from "../../db"
import type { Stream } from "../streams"
import type { Activity } from "./repository"

const WORKSPACE_ID = `ws_test`
const STREAM_ID = `stream_test`
const MESSAGE_ID = `msg_test`
const USER_ID = `usr_actor`
const TARGET_USER_ID = `usr_target`

function fakeStream(overrides: Partial<Stream> = {}): Stream {
  return {
    id: STREAM_ID,
    workspaceId: WORKSPACE_ID,
    type: StreamTypes.DM,
    displayName: "Test DM",
    slug: null,
    description: null,
    visibility: Visibilities.PRIVATE,
    parentStreamId: null,
    parentMessageId: null,
    rootStreamId: null,
    companionMode: CompanionModes.OFF,
    companionPersonaId: null,
    createdBy: USER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    displayNameGeneratedAt: null,
    ...overrides,
  }
}

function fakeActivity(context: Record<string, unknown>): Activity[] {
  return [
    {
      id: "act_1",
      workspaceId: WORKSPACE_ID,
      userId: TARGET_USER_ID,
      activityType: "message",
      streamId: STREAM_ID,
      messageId: MESSAGE_ID,
      actorId: USER_ID,
      actorType: AuthorTypes.USER,
      context,
      readAt: null,
      createdAt: new Date(),
    },
  ]
}

function setupService() {
  // Mock withClient to just call the callback directly with a fake client
  spyOn(dbModule, "withClient").mockImplementation(async (_pool: any, fn: any) => fn({} as any))

  return new ActivityService({ pool: {} as any })
}

describe("ActivityService author name resolution", () => {
  afterEach(() => {
    mock.restore()
  })

  it("resolves user author name from UserRepository", async () => {
    const service = setupService()
    const stream = fakeStream()

    spyOn(StreamRepository, "findById").mockResolvedValue(stream)
    spyOn(StreamMemberRepository, "list").mockResolvedValue([{ memberId: TARGET_USER_ID }] as any)
    spyOn(resolveNotificationLevelsForStream as any, "call" as any)
    // Mock resolveNotificationLevelsForStream — it's a standalone function, so mock the module import
    const resolveModule = await import("../streams")
    spyOn(resolveModule, "resolveNotificationLevelsForStream").mockResolvedValue([
      { memberId: TARGET_USER_ID, effectiveLevel: NotificationLevels.ACTIVITY },
    ] as any)

    spyOn(UserRepository, "findById").mockResolvedValue({
      id: USER_ID,
      name: "Alice",
      workspaceId: WORKSPACE_ID,
      workosUserId: "workos_1",
      email: "alice@test.com",
      role: "owner",
      slug: "alice",
      description: null,
      avatarUrl: null,
      timezone: null,
      locale: null,
      pronouns: null,
      phone: null,
      githubUsername: null,
      setupCompleted: true,
      joinedAt: new Date(),
    })

    let capturedContext: Record<string, unknown> | undefined
    spyOn(ActivityRepository, "insertBatch").mockImplementation(async (_db: any, params: any) => {
      capturedContext = params.context
      return fakeActivity(params.context)
    })

    await service.processMessageNotifications({
      workspaceId: WORKSPACE_ID,
      streamId: STREAM_ID,
      messageId: MESSAGE_ID,
      actorId: USER_ID,
      actorType: AuthorTypes.USER,
      contentMarkdown: "hello",
      excludeUserIds: new Set(),
    })

    expect(capturedContext?.authorName).toBe("Alice")
    expect(UserRepository.findById).toHaveBeenCalled()
  })

  it("resolves bot author name from BotRepository", async () => {
    const service = setupService()
    const botId = "bot_test"
    const stream = fakeStream()

    spyOn(StreamRepository, "findById").mockResolvedValue(stream)
    spyOn(StreamMemberRepository, "list").mockResolvedValue([{ memberId: TARGET_USER_ID }] as any)
    const resolveModule = await import("../streams")
    spyOn(resolveModule, "resolveNotificationLevelsForStream").mockResolvedValue([
      { memberId: TARGET_USER_ID, effectiveLevel: NotificationLevels.ACTIVITY },
    ] as any)

    spyOn(BotRepository, "findById").mockResolvedValue({
      id: botId,
      workspaceId: WORKSPACE_ID,
      apiKeyId: null,
      slug: "helper-bot",
      name: "Helper Bot",
      description: null,
      avatarEmoji: null,
      avatarUrl: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    let capturedContext: Record<string, unknown> | undefined
    spyOn(ActivityRepository, "insertBatch").mockImplementation(async (_db: any, params: any) => {
      capturedContext = params.context
      return fakeActivity(params.context)
    })

    await service.processMessageNotifications({
      workspaceId: WORKSPACE_ID,
      streamId: STREAM_ID,
      messageId: MESSAGE_ID,
      actorId: botId,
      actorType: AuthorTypes.BOT,
      contentMarkdown: "bot reply",
      excludeUserIds: new Set(),
    })

    expect(capturedContext?.authorName).toBe("Helper Bot")
    expect(BotRepository.findById).toHaveBeenCalled()
  })

  it("resolves persona author name from PersonaRepository", async () => {
    const service = setupService()
    const personaId = "persona_test"
    const stream = fakeStream()

    spyOn(StreamRepository, "findById").mockResolvedValue(stream)
    spyOn(StreamMemberRepository, "list").mockResolvedValue([{ memberId: TARGET_USER_ID }] as any)
    const resolveModule = await import("../streams")
    spyOn(resolveModule, "resolveNotificationLevelsForStream").mockResolvedValue([
      { memberId: TARGET_USER_ID, effectiveLevel: NotificationLevels.ACTIVITY },
    ] as any)

    spyOn(PersonaRepository, "findById").mockResolvedValue({
      id: personaId,
      workspaceId: WORKSPACE_ID,
      slug: "ada",
      name: "Ada",
      description: null,
      avatarEmoji: null,
      systemPrompt: null,
      model: "claude-sonnet-4-5-20250514",
      temperature: null,
      maxTokens: null,
      enabledTools: null,
      managedBy: "workspace",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    let capturedContext: Record<string, unknown> | undefined
    spyOn(ActivityRepository, "insertBatch").mockImplementation(async (_db: any, params: any) => {
      capturedContext = params.context
      return fakeActivity(params.context)
    })

    await service.processMessageNotifications({
      workspaceId: WORKSPACE_ID,
      streamId: STREAM_ID,
      messageId: MESSAGE_ID,
      actorId: personaId,
      actorType: AuthorTypes.PERSONA,
      contentMarkdown: "persona reply",
      excludeUserIds: new Set(),
    })

    expect(capturedContext?.authorName).toBe("Ada")
    expect(PersonaRepository.findById).toHaveBeenCalled()
  })

  it("resolves system author as 'Threa'", async () => {
    const service = setupService()
    const stream = fakeStream()

    spyOn(StreamRepository, "findById").mockResolvedValue(stream)
    spyOn(StreamMemberRepository, "list").mockResolvedValue([{ memberId: TARGET_USER_ID }] as any)
    const resolveModule = await import("../streams")
    spyOn(resolveModule, "resolveNotificationLevelsForStream").mockResolvedValue([
      { memberId: TARGET_USER_ID, effectiveLevel: NotificationLevels.ACTIVITY },
    ] as any)

    let capturedContext: Record<string, unknown> | undefined
    spyOn(ActivityRepository, "insertBatch").mockImplementation(async (_db: any, params: any) => {
      capturedContext = params.context
      return fakeActivity(params.context)
    })

    await service.processMessageNotifications({
      workspaceId: WORKSPACE_ID,
      streamId: STREAM_ID,
      messageId: MESSAGE_ID,
      actorId: "system",
      actorType: AuthorTypes.SYSTEM,
      contentMarkdown: "system message",
      excludeUserIds: new Set(),
    })

    expect(capturedContext?.authorName).toBe("Threa")
  })

  it("resolves null for unknown actor type", async () => {
    const service = setupService()
    const stream = fakeStream()

    spyOn(StreamRepository, "findById").mockResolvedValue(stream)
    spyOn(StreamMemberRepository, "list").mockResolvedValue([{ memberId: TARGET_USER_ID }] as any)
    const resolveModule = await import("../streams")
    spyOn(resolveModule, "resolveNotificationLevelsForStream").mockResolvedValue([
      { memberId: TARGET_USER_ID, effectiveLevel: NotificationLevels.ACTIVITY },
    ] as any)

    let capturedContext: Record<string, unknown> | undefined
    spyOn(ActivityRepository, "insertBatch").mockImplementation(async (_db: any, params: any) => {
      capturedContext = params.context
      return fakeActivity(params.context)
    })

    await service.processMessageNotifications({
      workspaceId: WORKSPACE_ID,
      streamId: STREAM_ID,
      messageId: MESSAGE_ID,
      actorId: "unknown_123",
      actorType: "unknown_type",
      contentMarkdown: "mystery",
      excludeUserIds: new Set(),
    })

    expect(capturedContext?.authorName).toBeNull()
  })
})
