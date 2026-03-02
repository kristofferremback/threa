import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Pool } from "pg"
import { StreamTypes, Visibilities } from "@threa/types"
import { computeAgentAccessSpec } from "../../src/features/agents"
import { SearchRepository } from "../../src/features/search"
import { StreamMemberRepository, StreamRepository } from "../../src/features/streams"
import { WorkspaceRepository } from "../../src/features/workspaces"
import { streamId, userId, workspaceId } from "../../src/lib/id"
import { addTestMember, setupTestDatabase, withTestTransaction } from "./setup"

describe("Agent Access Scope", () => {
  let pool: Pool

  beforeAll(async () => {
    pool = await setupTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  test("DM agent access intersects participant visibility instead of unioning it", async () => {
    await withTestTransaction(pool, async (client) => {
      const ownerWorkosUserId = userId()
      const secondWorkosUserId = userId()
      const outsiderWorkosUserId = userId()
      const testWorkspaceId = workspaceId()

      await WorkspaceRepository.insert(client, {
        id: testWorkspaceId,
        name: "Agent Access Scope Workspace",
        slug: `agent-access-scope-${testWorkspaceId}`,
        createdBy: ownerWorkosUserId,
      })

      const ownerMember = await addTestMember(client, testWorkspaceId, ownerWorkosUserId)
      const secondMember = await addTestMember(client, testWorkspaceId, secondWorkosUserId)
      const outsiderMember = await addTestMember(client, testWorkspaceId, outsiderWorkosUserId)

      const sharedDmId = streamId()
      const sharedPrivateChannelId = streamId()
      const publicChannelId = streamId()
      const ownerScratchpadId = streamId()
      const secondScratchpadId = streamId()
      const ownerOutsiderDmId = streamId()

      await StreamRepository.insert(client, {
        id: sharedDmId,
        workspaceId: testWorkspaceId,
        type: StreamTypes.DM,
        visibility: Visibilities.PRIVATE,
        createdBy: ownerMember.id,
      })
      await StreamMemberRepository.insert(client, sharedDmId, ownerMember.id)
      await StreamMemberRepository.insert(client, sharedDmId, secondMember.id)

      await StreamRepository.insert(client, {
        id: sharedPrivateChannelId,
        workspaceId: testWorkspaceId,
        type: StreamTypes.CHANNEL,
        visibility: Visibilities.PRIVATE,
        createdBy: ownerMember.id,
      })
      await StreamMemberRepository.insert(client, sharedPrivateChannelId, ownerMember.id)
      await StreamMemberRepository.insert(client, sharedPrivateChannelId, secondMember.id)

      await StreamRepository.insert(client, {
        id: publicChannelId,
        workspaceId: testWorkspaceId,
        type: StreamTypes.CHANNEL,
        visibility: Visibilities.PUBLIC,
        createdBy: ownerMember.id,
      })

      await StreamRepository.insert(client, {
        id: ownerScratchpadId,
        workspaceId: testWorkspaceId,
        type: StreamTypes.SCRATCHPAD,
        visibility: Visibilities.PRIVATE,
        createdBy: ownerMember.id,
      })
      await StreamMemberRepository.insert(client, ownerScratchpadId, ownerMember.id)

      await StreamRepository.insert(client, {
        id: secondScratchpadId,
        workspaceId: testWorkspaceId,
        type: StreamTypes.SCRATCHPAD,
        visibility: Visibilities.PRIVATE,
        createdBy: secondMember.id,
      })
      await StreamMemberRepository.insert(client, secondScratchpadId, secondMember.id)

      await StreamRepository.insert(client, {
        id: ownerOutsiderDmId,
        workspaceId: testWorkspaceId,
        type: StreamTypes.DM,
        visibility: Visibilities.PRIVATE,
        createdBy: ownerMember.id,
      })
      await StreamMemberRepository.insert(client, ownerOutsiderDmId, ownerMember.id)
      await StreamMemberRepository.insert(client, ownerOutsiderDmId, outsiderMember.id)

      const sharedDm = await StreamRepository.findById(client, sharedDmId)
      expect(sharedDm).not.toBeNull()

      const accessSpec = await computeAgentAccessSpec(client, {
        stream: sharedDm!,
        invokingUserId: ownerMember.id,
      })

      expect(accessSpec.type).toBe("user_intersection")
      if (accessSpec.type !== "user_intersection") {
        throw new Error(`Expected DM access to use participant intersection, got ${accessSpec.type}`)
      }
      expect(accessSpec.userIds).toHaveLength(2)
      expect(accessSpec.userIds).toEqual(expect.arrayContaining([ownerMember.id, secondMember.id]))

      const accessibleStreamIds = await SearchRepository.getAccessibleStreamsForAgent(
        client,
        accessSpec,
        testWorkspaceId
      )

      expect(accessibleStreamIds).toHaveLength(3)
      expect(accessibleStreamIds).toContain(sharedDmId)
      expect(accessibleStreamIds).toContain(sharedPrivateChannelId)
      expect(accessibleStreamIds).toContain(publicChannelId)
      expect(accessibleStreamIds).not.toContain(ownerScratchpadId)
      expect(accessibleStreamIds).not.toContain(secondScratchpadId)
      expect(accessibleStreamIds).not.toContain(ownerOutsiderDmId)
    })
  })
})
