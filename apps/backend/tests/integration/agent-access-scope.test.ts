import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Pool } from "pg"
import { DM_PARTICIPANT_COUNT, StreamTypes, Visibilities } from "@threa/types"
import { computeAgentAccessSpec, type AgentAccessSpec } from "../../src/features/agents"
import { SearchRepository } from "../../src/features/search"
import { StreamMemberRepository, StreamRepository } from "../../src/features/streams"
import { WorkspaceRepository } from "../../src/features/workspaces"
import { streamId, userId, workspaceId } from "../../src/lib/id"
import { addTestMember, setupTestDatabase, withTestTransaction } from "./setup"

function makeMalformedUserIntersectionSpec(userIds: string[]): AgentAccessSpec {
  // Intentionally bypass the tuple type to verify the repository still fails closed at runtime.
  return { type: "user_intersection", userIds } as unknown as AgentAccessSpec
}

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

      expect(new Set(accessibleStreamIds)).toEqual(new Set([sharedDmId, sharedPrivateChannelId, publicChannelId]))
    })
  })

  test("user_intersection fails closed unless constructed with exactly two distinct users", async () => {
    await withTestTransaction(pool, async (client) => {
      const ownerWorkosUserId = userId()
      const secondWorkosUserId = userId()
      const thirdWorkosUserId = userId()
      const testWorkspaceId = workspaceId()

      await WorkspaceRepository.insert(client, {
        id: testWorkspaceId,
        name: "Malformed Agent Access Scope Workspace",
        slug: `malformed-agent-access-scope-${testWorkspaceId}`,
        createdBy: ownerWorkosUserId,
      })

      const ownerMember = await addTestMember(client, testWorkspaceId, ownerWorkosUserId)
      const secondMember = await addTestMember(client, testWorkspaceId, secondWorkosUserId)
      const thirdMember = await addTestMember(client, testWorkspaceId, thirdWorkosUserId)

      const expectedError = `user_intersection access spec requires exactly ${DM_PARTICIPANT_COUNT} distinct users`

      await expect(
        SearchRepository.getAccessibleStreamsForAgent(
          client,
          makeMalformedUserIntersectionSpec([ownerMember.id]),
          testWorkspaceId
        )
      ).rejects.toThrow(expectedError)

      await expect(
        SearchRepository.getAccessibleStreamsForAgent(
          client,
          makeMalformedUserIntersectionSpec([ownerMember.id, ownerMember.id]),
          testWorkspaceId
        )
      ).rejects.toThrow(expectedError)

      await expect(
        SearchRepository.getAccessibleStreamsForAgent(
          client,
          makeMalformedUserIntersectionSpec([ownerMember.id, secondMember.id, thirdMember.id]),
          testWorkspaceId
        )
      ).rejects.toThrow(expectedError)
    })
  })
})
