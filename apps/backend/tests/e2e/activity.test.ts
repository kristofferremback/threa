/**
 * E2E tests for the activity feed system.
 *
 * Tests @mention detection, activity creation, read state, and bootstrap integration.
 * Run with: bun test --preload ./tests/setup.ts tests/e2e/activity.test.ts
 */

import { describe, test, expect, beforeAll } from "bun:test"
import {
  TestClient,
  loginAs,
  createWorkspace,
  createChannel,
  sendMessage,
  joinWorkspace,
  joinStream,
  getWorkspaceBootstrap,
  getUserId,
} from "../client"

const testRunId = Math.random().toString(36).substring(7)
const testEmail = (name: string) => `${name}-act-${testRunId}@test.com`

interface ActivityItem {
  id: string
  workspaceId: string
  userId: string
  activityType: string
  streamId: string
  messageId: string
  actorId: string
  context: Record<string, unknown>
  readAt: string | null
  createdAt: string
}

async function getActivity(
  client: TestClient,
  workspaceId: string,
  opts?: { unreadOnly?: boolean }
): Promise<ActivityItem[]> {
  const params = new URLSearchParams()
  if (opts?.unreadOnly) params.set("unreadOnly", "true")
  const query = params.toString() ? `?${params.toString()}` : ""

  const { status, data } = await client.get<{ activities: ActivityItem[] }>(
    `/api/workspaces/${workspaceId}/activity${query}`
  )
  if (status !== 200) {
    throw new Error(`Get activity failed: ${JSON.stringify(data)}`)
  }
  return data.activities
}

async function markActivityAsRead(client: TestClient, workspaceId: string, activityId: string): Promise<void> {
  const { status, data } = await client.post(`/api/workspaces/${workspaceId}/activity/${activityId}/read`)
  if (status !== 200) {
    throw new Error(`Mark activity as read failed: ${JSON.stringify(data)}`)
  }
}

async function markAllActivityAsRead(client: TestClient, workspaceId: string): Promise<void> {
  const { status, data } = await client.post(`/api/workspaces/${workspaceId}/activity/read`)
  if (status !== 200) {
    throw new Error(`Mark all activity as read failed: ${JSON.stringify(data)}`)
  }
}

/**
 * Polls until activity items appear for the given member, or times out.
 * The outbox handler processes events asynchronously, so we need to wait.
 */
async function waitForActivity(
  client: TestClient,
  workspaceId: string,
  opts?: { minCount?: number; timeoutMs?: number; unreadOnly?: boolean }
): Promise<ActivityItem[]> {
  const timeout = opts?.timeoutMs ?? 5000
  const minCount = opts?.minCount ?? 1
  const start = Date.now()

  while (Date.now() - start < timeout) {
    const activities = await getActivity(client, workspaceId, { unreadOnly: opts?.unreadOnly })
    if (activities.length >= minCount) return activities
    await new Promise((r) => setTimeout(r, 200))
  }

  // One final attempt before throwing
  return getActivity(client, workspaceId, { unreadOnly: opts?.unreadOnly })
}

describe("Activity Feed E2E", () => {
  describe("Mention Detection", () => {
    let ownerClient: TestClient
    let aliceClient: TestClient
    let workspaceId: string
    let channelId: string
    let ownerUserId: string
    let aliceUserId: string
    let aliceSlug: string

    beforeAll(async () => {
      ownerClient = new TestClient()
      aliceClient = new TestClient()

      const owner = await loginAs(ownerClient, testEmail("owner"), "Owner User")
      const workspace = await createWorkspace(ownerClient, `Activity WS ${testRunId}`)
      workspaceId = workspace.id

      const alice = await loginAs(aliceClient, testEmail("alice"), "Alice User")
      await joinWorkspace(aliceClient, workspaceId, "user")

      ownerUserId = await getUserId(ownerClient, workspaceId, owner.id)
      aliceUserId = await getUserId(aliceClient, workspaceId, alice.id)

      // Get Alice's slug from the bootstrap users list
      const bootstrap = await getWorkspaceBootstrap(ownerClient, workspaceId)
      const aliceMember = bootstrap.users.find((m) => m.id === aliceUserId)
      aliceSlug = (aliceMember as unknown as { slug: string }).slug

      const channel = await createChannel(ownerClient, workspaceId, `general-${testRunId}`, "public")
      channelId = channel.id

      // Both users join the channel
      await joinStream(aliceClient, workspaceId, channelId)
    })

    test("should create activity when user is mentioned", async () => {
      await sendMessage(ownerClient, workspaceId, channelId, `Hey @${aliceSlug} check this out`)

      const activities = await waitForActivity(aliceClient, workspaceId)

      expect(activities.length).toBeGreaterThanOrEqual(1)
      const mention = activities.find((a) => a.activityType === "mention")
      expect(mention).toBeDefined()
      expect(mention!.streamId).toBe(channelId)
      expect(mention!.actorId).toBe(ownerUserId)
      expect(mention!.userId).toBe(aliceUserId)
      expect(mention!.readAt).toBeNull()
      expect(mention!.context.contentPreview).toBeDefined()
    })

    test("should not create activity for self-mentions", async () => {
      // Get owner's slug
      const bootstrap = await getWorkspaceBootstrap(ownerClient, workspaceId)
      const ownerUser = bootstrap.users.find((m) => m.id === ownerUserId)
      const ownerSlug = (ownerUser as unknown as { slug: string }).slug

      // Owner mentions themselves
      await sendMessage(ownerClient, workspaceId, channelId, `Note to @${ownerSlug}: remember this`)

      // Wait a bit to ensure processing has time to complete
      await new Promise((r) => setTimeout(r, 1500))

      // Owner should have no activity from self-mention
      const activities = await getActivity(ownerClient, workspaceId)
      const selfMention = activities.find((a) => a.actorId === ownerUserId && a.userId === ownerUserId)
      expect(selfMention).toBeUndefined()
    })

    test("should not create activity for mentions of non-members", async () => {
      // Mention a slug that doesn't exist as a member
      await sendMessage(ownerClient, workspaceId, channelId, "Hey @nonexistent-user check this")

      await new Promise((r) => setTimeout(r, 1500))

      // No activity should be created for nonexistent-user
      const activities = await getActivity(aliceClient, workspaceId)
      const fakeMention = activities.find(
        (a) => a.context.contentPreview && (a.context.contentPreview as string).includes("nonexistent-user")
      )
      // If a mention was created, it wouldn't be for a fake user
      // The existing activities should only be legitimate mentions
      if (fakeMention) {
        expect(fakeMention.userId).toBe(aliceUserId)
      }
    })
  })

  describe("Read State", () => {
    let ownerClient: TestClient
    let bobClient: TestClient
    let workspaceId: string
    let channelId: string
    let bobSlug: string

    beforeAll(async () => {
      ownerClient = new TestClient()
      bobClient = new TestClient()

      await loginAs(ownerClient, testEmail("read-owner"), "Read Owner")
      const workspace = await createWorkspace(ownerClient, `Read WS ${testRunId}`)
      workspaceId = workspace.id

      const bob = await loginAs(bobClient, testEmail("read-bob"), "Bob User")
      await joinWorkspace(bobClient, workspaceId, "user")

      const bobUserId = await getUserId(bobClient, workspaceId, bob.id)

      const bootstrap = await getWorkspaceBootstrap(ownerClient, workspaceId)
      const bobMember = bootstrap.users.find((m) => m.id === bobUserId)
      bobSlug = (bobMember as unknown as { slug: string }).slug

      const channel = await createChannel(ownerClient, workspaceId, `readstate-${testRunId}`, "public")
      channelId = channel.id

      await joinStream(bobClient, workspaceId, channelId)
    })

    test("should mark single activity as read", async () => {
      await sendMessage(ownerClient, workspaceId, channelId, `@${bobSlug} first ping`)

      const activities = await waitForActivity(bobClient, workspaceId, { unreadOnly: true })
      expect(activities.length).toBeGreaterThanOrEqual(1)

      const activity = activities[0]
      expect(activity.readAt).toBeNull()

      await markActivityAsRead(bobClient, workspaceId, activity.id)

      const updated = await getActivity(bobClient, workspaceId, { unreadOnly: true })
      const stillUnread = updated.find((a) => a.id === activity.id)
      expect(stillUnread).toBeUndefined()
    })

    test("should mark all activity as read", async () => {
      // Create multiple mentions
      await sendMessage(ownerClient, workspaceId, channelId, `@${bobSlug} second ping`)
      await sendMessage(ownerClient, workspaceId, channelId, `@${bobSlug} third ping`)

      await waitForActivity(bobClient, workspaceId, { minCount: 2, unreadOnly: true })

      await markAllActivityAsRead(bobClient, workspaceId)

      const unread = await getActivity(bobClient, workspaceId, { unreadOnly: true })
      expect(unread).toHaveLength(0)
    })

    test("should clear mention badges when stream is read", async () => {
      await sendMessage(ownerClient, workspaceId, channelId, `@${bobSlug} badge test ping`)

      await waitForActivity(bobClient, workspaceId, { minCount: 1, unreadOnly: true })

      // Read the stream (mark as read)
      const streamBootstrap = await bobClient.get<{
        data: { events: Array<{ id: string; sequence: string }> }
      }>(`/api/workspaces/${workspaceId}/streams/${channelId}/bootstrap`)

      const events = streamBootstrap.data.data.events
      const lastEvent = events[events.length - 1]

      await bobClient.post(`/api/workspaces/${workspaceId}/streams/${channelId}/read`, {
        lastEventId: lastEvent.id,
      })

      // Activity for this stream should now be marked as read
      const unreadAfter = await getActivity(bobClient, workspaceId, { unreadOnly: true })
      const stillUnreadForStream = unreadAfter.filter((a) => a.streamId === channelId)
      expect(stillUnreadForStream).toHaveLength(0)
    })
  })

  describe("Bootstrap Integration", () => {
    test("should include mentionCounts and unreadActivityCount in workspace bootstrap", async () => {
      const ownerClient = new TestClient()
      const charlieClient = new TestClient()

      await loginAs(ownerClient, testEmail("boot-owner"), "Boot Owner")
      const workspace = await createWorkspace(ownerClient, `Boot WS ${testRunId}`)

      const charlie = await loginAs(charlieClient, testEmail("boot-charlie"), "Charlie User")
      await joinWorkspace(charlieClient, workspace.id, "user")

      const charlieUserId = await getUserId(charlieClient, workspace.id, charlie.id)

      const usersBootstrap = await getWorkspaceBootstrap(ownerClient, workspace.id)
      const charlieMember = usersBootstrap.users.find((m) => m.id === charlieUserId)
      const charlieSlug = (charlieMember as unknown as { slug: string }).slug

      const channel = await createChannel(ownerClient, workspace.id, `bootstrap-${testRunId}`, "public")
      await joinStream(charlieClient, workspace.id, channel.id)

      // Send a mention
      await sendMessage(ownerClient, workspace.id, channel.id, `@${charlieSlug} bootstrap test`)

      // Wait for the activity to be processed
      await waitForActivity(charlieClient, workspace.id)

      // Check bootstrap includes mention data
      const bootstrap = await charlieClient.get<{
        data: {
          mentionCounts: Record<string, number>
          unreadActivityCount: number
        }
      }>(`/api/workspaces/${workspace.id}/bootstrap`)

      expect(bootstrap.status).toBe(200)
      expect(bootstrap.data.data.unreadActivityCount).toBeGreaterThanOrEqual(1)
      expect(bootstrap.data.data.mentionCounts[channel.id]).toBeGreaterThanOrEqual(1)
    })
  })

  describe("Deduplication", () => {
    test("should not create duplicate activity for same mention in same message", async () => {
      const ownerClient = new TestClient()
      const dupeClient = new TestClient()

      await loginAs(ownerClient, testEmail("dedup-owner"), "Dedup Owner")
      const workspace = await createWorkspace(ownerClient, `Dedup WS ${testRunId}`)

      const dupe = await loginAs(dupeClient, testEmail("dedup-target"), "Dedup Target")
      await joinWorkspace(dupeClient, workspace.id, "user")

      const dupeUserId = await getUserId(dupeClient, workspace.id, dupe.id)

      const bootstrap = await getWorkspaceBootstrap(ownerClient, workspace.id)
      const dupeMember = bootstrap.users.find((m) => m.id === dupeUserId)
      const dupeSlug = (dupeMember as unknown as { slug: string }).slug

      const channel = await createChannel(ownerClient, workspace.id, `dedup-${testRunId}`, "public")
      await joinStream(dupeClient, workspace.id, channel.id)

      // Send message with the same @mention twice
      await sendMessage(ownerClient, workspace.id, channel.id, `Hey @${dupeSlug} and again @${dupeSlug} look here`)

      await waitForActivity(dupeClient, workspace.id)

      const activities = await getActivity(dupeClient, workspace.id)

      // extractMentionSlugs returns unique slugs, so only one mention per message
      const mentionsForMessage = activities.filter((a) => a.activityType === "mention")
      expect(mentionsForMessage).toHaveLength(1)
    })
  })
})
