import { beforeAll, describe, expect, test } from "bun:test"
import {
  TestClient,
  loginAs,
  createWorkspace,
  createChannel,
  createScratchpad,
  createThread,
  sendMessage,
  getStream,
  getBootstrap,
  joinWorkspace,
  getMemberId,
  updateStream,
  addStreamMember,
  removeStreamMember,
  checkSlugAvailable,
} from "../client"

const testRunId = Math.random().toString(36).substring(7)
const testEmail = (name: string) => `${name}-${testRunId}@test.com`

describe("Stream Settings E2E", () => {
  describe("Stream Update Validation", () => {
    let client: TestClient
    let workspaceId: string
    let channelId: string
    let scratchpadId: string

    beforeAll(async () => {
      client = new TestClient()
      await loginAs(client, testEmail("update-owner"), "Update Owner")
      const workspace = await createWorkspace(client, `Update WS ${testRunId}`)
      workspaceId = workspace.id

      const channel = await createChannel(client, workspaceId, `update-ch-${testRunId}`)
      channelId = channel.id

      const scratchpad = await createScratchpad(client, workspaceId)
      scratchpadId = scratchpad.id
    })

    test("should update channel slug and description", async () => {
      const newSlug = `updated-ch-${testRunId}`
      const { status, data } = await updateStream(client, workspaceId, channelId, {
        slug: newSlug,
        description: "A test description",
      })

      expect(status).toBe(200)
      const stream = (data as { stream: { slug: string; description: string } }).stream
      expect(stream.slug).toBe(newSlug)
      expect(stream.description).toBe("A test description")
    })

    test("should reject displayName on channel", async () => {
      const { status, data } = await updateStream(client, workspaceId, channelId, {
        displayName: "Not Allowed",
      })

      expect(status).toBe(400)
      const body = data as { error: string; details: Record<string, string[]> }
      expect(body.error).toBe("Validation failed")
      expect(body.details.displayName).toBeDefined()
    })

    test("should return all violations at once for scratchpad", async () => {
      const { status, data } = await updateStream(client, workspaceId, scratchpadId, {
        slug: "not-allowed",
        visibility: "public",
      })

      expect(status).toBe(400)
      const body = data as { error: string; details: Record<string, string[]> }
      expect(body.error).toBe("Validation failed")
      expect(body.details.slug).toBeDefined()
      expect(body.details.visibility).toBeDefined()
    })

    test("should update scratchpad displayName", async () => {
      const { status, data } = await updateStream(client, workspaceId, scratchpadId, {
        displayName: "My Scratchpad",
      })

      expect(status).toBe(200)
      const stream = (data as { stream: { displayName: string } }).stream
      expect(stream.displayName).toBe("My Scratchpad")
    })
  })

  describe("Slug Availability", () => {
    let client: TestClient
    let workspaceId: string
    let channelId: string
    let channelSlug: string

    beforeAll(async () => {
      client = new TestClient()
      await loginAs(client, testEmail("slug-owner"), "Slug Owner")
      const workspace = await createWorkspace(client, `Slug WS ${testRunId}`)
      workspaceId = workspace.id

      channelSlug = `slug-ch-${testRunId}`
      const channel = await createChannel(client, workspaceId, channelSlug)
      channelId = channel.id
    })

    test("should return available=true for unused slug", async () => {
      const { status, data } = await checkSlugAvailable(client, workspaceId, `unused-${testRunId}`)

      expect(status).toBe(200)
      expect(data.available).toBe(true)
    })

    test("should return available=false for taken slug", async () => {
      const { status, data } = await checkSlugAvailable(client, workspaceId, channelSlug)

      expect(status).toBe(200)
      expect(data.available).toBe(false)
    })

    test("should return available=true when excluding own slug", async () => {
      const { status, data } = await checkSlugAvailable(client, workspaceId, channelSlug, channelId)

      expect(status).toBe(200)
      expect(data.available).toBe(true)
    })
  })

  describe("Slug Update + Uniqueness", () => {
    let client: TestClient
    let workspaceId: string

    beforeAll(async () => {
      client = new TestClient()
      await loginAs(client, testEmail("slug-uniq-owner"), "Slug Uniq Owner")
      const workspace = await createWorkspace(client, `Slug Uniq WS ${testRunId}`)
      workspaceId = workspace.id
    })

    test("should update channel slug", async () => {
      const channel = await createChannel(client, workspaceId, `old-slug-${testRunId}`)
      const newSlug = `new-slug-${testRunId}`

      await updateStream(client, workspaceId, channel.id, { slug: newSlug })

      const updated = await getStream(client, workspaceId, channel.id)
      expect(updated.slug).toBe(newSlug)
    })

    test("should reject duplicate slug on update", async () => {
      const channelA = await createChannel(client, workspaceId, `dup-a-${testRunId}`)
      await createChannel(client, workspaceId, `dup-b-${testRunId}`)

      const { status, data } = await updateStream(client, workspaceId, channelA.id, {
        slug: `dup-b-${testRunId}`,
      })

      expect(status).toBe(409)
      const body = data as { error: string }
      expect(body.error).toContain("already exists")
    })
  })

  describe("Member Add", () => {
    let ownerClient: TestClient
    let memberClient: TestClient
    let workspaceId: string
    let memberMemberId: string

    beforeAll(async () => {
      ownerClient = new TestClient()
      memberClient = new TestClient()

      await loginAs(ownerClient, testEmail("add-owner"), "Add Owner")
      const workspace = await createWorkspace(ownerClient, `Add Member WS ${testRunId}`)
      workspaceId = workspace.id

      const memberUser = await loginAs(memberClient, testEmail("add-member"), "Add Member")
      await joinWorkspace(memberClient, workspaceId, "member")
      memberMemberId = await getMemberId(memberClient, workspaceId, memberUser.id)
    })

    test("should add member to channel", async () => {
      const channel = await createChannel(ownerClient, workspaceId, `add-ch-${testRunId}`, "private")

      const { status } = await addStreamMember(ownerClient, workspaceId, channel.id, memberMemberId)
      expect(status).toBe(201)

      // Verify member appears in bootstrap (member client can now access)
      const bootstrap = await getBootstrap(memberClient, workspaceId, channel.id)
      const memberIds = bootstrap.members.map((m: { memberId?: string; userId?: string }) => m.memberId ?? m.userId)
      expect(memberIds).toContain(memberMemberId)
    })

    test("should reject adding member to scratchpad", async () => {
      const scratchpad = await createScratchpad(ownerClient, workspaceId)

      const { status, data } = await addStreamMember(ownerClient, workspaceId, scratchpad.id, memberMemberId)

      expect(status).toBe(400)
      const body = data as { error: string }
      expect(body.error).toContain("Cannot add members")
    })

    test("should reject adding non-workspace member", async () => {
      const channel = await createChannel(ownerClient, workspaceId, `add-nonmember-${testRunId}`)

      const { status, data } = await addStreamMember(ownerClient, workspaceId, channel.id, "member_fake_00000000")

      expect(status).toBe(404)
      const body = data as { error: string }
      expect(body.error).toContain("Member not found")
    })

    test("should cascade thread member add to root channel", async () => {
      const channel = await createChannel(ownerClient, workspaceId, `cascade-add-${testRunId}`)
      const message = await sendMessage(ownerClient, workspaceId, channel.id, "Thread parent")
      const thread = await createThread(ownerClient, workspaceId, channel.id, message.id)

      // Add member to thread — should auto-add to root channel
      const { status } = await addStreamMember(ownerClient, workspaceId, thread.id, memberMemberId)
      expect(status).toBe(201)

      // Verify member also in root channel bootstrap
      const channelBootstrap = await getBootstrap(memberClient, workspaceId, channel.id)
      const channelMemberIds = channelBootstrap.members.map(
        (m: { memberId?: string; userId?: string }) => m.memberId ?? m.userId
      )
      expect(channelMemberIds).toContain(memberMemberId)
    })
  })

  describe("Member Remove", () => {
    let ownerClient: TestClient
    let adminClient: TestClient
    let memberClient: TestClient
    let workspaceId: string
    let ownerMemberId: string
    let adminMemberId: string
    let memberMemberId: string

    beforeAll(async () => {
      ownerClient = new TestClient()
      adminClient = new TestClient()
      memberClient = new TestClient()

      const ownerUser = await loginAs(ownerClient, testEmail("rm-owner"), "Remove Owner")
      const workspace = await createWorkspace(ownerClient, `Remove Member WS ${testRunId}`)
      workspaceId = workspace.id
      ownerMemberId = await getMemberId(ownerClient, workspaceId, ownerUser.id)

      const adminUser = await loginAs(adminClient, testEmail("rm-admin"), "Remove Admin")
      await joinWorkspace(adminClient, workspaceId, "admin")
      adminMemberId = await getMemberId(adminClient, workspaceId, adminUser.id)

      const memberUser = await loginAs(memberClient, testEmail("rm-member"), "Remove Member")
      await joinWorkspace(memberClient, workspaceId, "member")
      memberMemberId = await getMemberId(memberClient, workspaceId, memberUser.id)
    })

    test("should remove member from channel", async () => {
      const channel = await createChannel(ownerClient, workspaceId, `rm-ch-${testRunId}`, "private")

      const addAdmin = await addStreamMember(ownerClient, workspaceId, channel.id, adminMemberId)
      expect(addAdmin.status).toBe(201)
      const addMember = await addStreamMember(ownerClient, workspaceId, channel.id, memberMemberId)
      expect(addMember.status).toBe(201)

      // Admin removes member
      const { status } = await removeStreamMember(adminClient, workspaceId, channel.id, memberMemberId)
      expect(status).toBe(204)

      // Removed member can no longer access channel
      const { status: accessStatus } = await memberClient.get(
        `/api/workspaces/${workspaceId}/streams/${channel.id}/bootstrap`
      )
      expect(accessStatus).toBe(404)
    })

    test("should cascade removal to descendant threads", async () => {
      const channel = await createChannel(ownerClient, workspaceId, `rm-cascade-${testRunId}`, "private")

      const addResult = await addStreamMember(ownerClient, workspaceId, channel.id, memberMemberId)
      expect(addResult.status).toBe(201)

      const message = await sendMessage(ownerClient, workspaceId, channel.id, "Thread parent for cascade")
      const thread = await createThread(ownerClient, workspaceId, channel.id, message.id)

      const addThreadResult = await addStreamMember(ownerClient, workspaceId, thread.id, memberMemberId)
      expect(addThreadResult.status).toBe(201)

      // Remove member from channel — should cascade to thread
      const { status } = await removeStreamMember(ownerClient, workspaceId, channel.id, memberMemberId)
      expect(status).toBe(204)

      // Member can no longer access thread either
      const { status: threadStatus } = await memberClient.get(
        `/api/workspaces/${workspaceId}/streams/${thread.id}/bootstrap`
      )
      expect(threadStatus).toBe(404)
    })

    test("should reject removal by regular member", async () => {
      const channel = await createChannel(ownerClient, workspaceId, `rm-noauth-${testRunId}`, "private")
      await addStreamMember(ownerClient, workspaceId, channel.id, memberMemberId)
      await addStreamMember(ownerClient, workspaceId, channel.id, adminMemberId)

      const { status, data } = await removeStreamMember(memberClient, workspaceId, channel.id, adminMemberId)

      expect(status).toBe(403)
      const body = data as { error: string }
      expect(body.error).toContain("owners and admins")
    })

    test("should reject removing the only member", async () => {
      const channel = await createChannel(ownerClient, workspaceId, `rm-last-${testRunId}`, "private")

      const { status, data } = await removeStreamMember(ownerClient, workspaceId, channel.id, ownerMemberId)

      expect(status).toBe(400)
      const body = data as { error: string }
      expect(body.error).toContain("only member")
    })
  })

  describe("Visibility Update", () => {
    test("should update channel visibility", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("vis-owner"), "Visibility Owner")
      const workspace = await createWorkspace(client, `Visibility WS ${testRunId}`)

      const channel = await createChannel(client, workspace.id, `vis-ch-${testRunId}`, "private")
      expect(channel.visibility).toBe("private")

      const { status, data } = await updateStream(client, workspace.id, channel.id, {
        visibility: "public",
      })

      expect(status).toBe(200)
      const updated = (data as { stream: { visibility: string } }).stream
      expect(updated.visibility).toBe("public")
    })
  })
})
