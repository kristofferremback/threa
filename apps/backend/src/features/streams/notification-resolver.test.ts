import { describe, test, expect, spyOn, beforeEach } from "bun:test"
import { resolveNotificationLevelsForStream } from "./notification-resolver"
import { StreamRepository } from "./repository"
import { StreamMemberRepository } from "./member-repository"
import type { Stream } from "./repository"
import type { StreamMember } from "./member-repository"

const mockFindById = spyOn(StreamRepository, "findById")
const mockList = spyOn(StreamMemberRepository, "list")

function makeStream(overrides: Partial<Stream> = {}): Stream {
  return {
    id: "stream_thread",
    workspaceId: "ws_1",
    type: "thread",
    displayName: null,
    slug: null,
    description: null,
    visibility: "private",
    parentStreamId: "stream_channel",
    parentMessageId: "msg_1",
    rootStreamId: "stream_channel",
    companionMode: "off",
    companionPersonaId: null,
    createdBy: "member_1",
    createdAt: new Date(),
    updatedAt: new Date(),
    archivedAt: null,
    displayNameGeneratedAt: null,
    ...overrides,
  }
}

function makeMembership(overrides: Partial<StreamMember> = {}): StreamMember {
  return {
    streamId: "stream_thread",
    memberId: "member_1",
    pinned: false,
    pinnedAt: null,
    notificationLevel: null,
    lastReadEventId: null,
    lastReadAt: null,
    joinedAt: new Date(),
    ...overrides,
  }
}

beforeEach(() => {
  mockFindById.mockReset()
  mockList.mockReset()
})

describe("resolveNotificationLevelsForStream", () => {
  test("should resolve all explicit members without ancestry queries", async () => {
    const stream = makeStream({ type: "channel", parentStreamId: null })
    const members = [
      makeMembership({ memberId: "member_1", notificationLevel: "everything" }),
      makeMembership({ memberId: "member_2", notificationLevel: "muted" }),
    ]

    const results = await resolveNotificationLevelsForStream({} as never, stream, members)

    expect(results).toEqual([
      { memberId: "member_1", effectiveLevel: "everything", source: "explicit" },
      { memberId: "member_2", effectiveLevel: "muted", source: "explicit" },
    ])
    // No ancestry queries needed
    expect(mockFindById).not.toHaveBeenCalled()
  })

  test("should fall back to defaults when no ancestors exist", async () => {
    const stream = makeStream({ type: "channel", parentStreamId: null })
    const members = [
      makeMembership({ memberId: "member_1", notificationLevel: null }),
      makeMembership({ memberId: "member_2", notificationLevel: null }),
    ]

    const results = await resolveNotificationLevelsForStream({} as never, stream, members)

    expect(results).toEqual([
      { memberId: "member_1", effectiveLevel: "mentions", source: "default" },
      { memberId: "member_2", effectiveLevel: "mentions", source: "default" },
    ])
  })

  test("should batch-resolve inheritance from parent stream", async () => {
    const threadStream = makeStream({ type: "thread", parentStreamId: "stream_channel" })
    const parentStream = makeStream({
      id: "stream_channel",
      type: "channel",
      parentStreamId: null,
    })

    const members = [
      makeMembership({ memberId: "member_1", notificationLevel: null }),
      makeMembership({ memberId: "member_2", notificationLevel: "muted" }),
      makeMembership({ memberId: "member_3", notificationLevel: null }),
    ]

    mockFindById.mockResolvedValue(parentStream)

    // Parent stream memberships
    mockList.mockResolvedValue([
      makeMembership({ streamId: "stream_channel", memberId: "member_1", notificationLevel: "everything" }),
      makeMembership({ streamId: "stream_channel", memberId: "member_3", notificationLevel: null }),
    ])

    const results = await resolveNotificationLevelsForStream({} as never, threadStream, members)

    const byMember = new Map(results.map((r) => [r.memberId, r]))

    // member_2: explicit muted
    expect(byMember.get("member_2")).toMatchObject({ effectiveLevel: "muted", source: "explicit" })
    // member_1: inherits everything → activity
    expect(byMember.get("member_1")).toMatchObject({ effectiveLevel: "activity", source: "inherited" })
    // member_3: no parent level, falls to default
    expect(byMember.get("member_3")).toMatchObject({ effectiveLevel: "activity", source: "default" })
  })

  test("should return empty array for empty members", async () => {
    const stream = makeStream()
    const results = await resolveNotificationLevelsForStream({} as never, stream, [])
    expect(results).toEqual([])
  })
})
