import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { Pool } from "pg"
import { StreamTypes, Visibilities } from "@threa/types"
import { computeAgentAccessSpec } from "../../src/features/agents"
import { createSearchStreamsTool } from "../../src/features/agents/tools"
import { SearchRepository } from "../../src/features/search"
import { StreamMemberRepository, StreamRepository } from "../../src/features/streams"
import { UserRepository, WorkspaceRepository } from "../../src/features/workspaces"
import { streamId, userId, workspaceId } from "../../src/lib/id"
import { setupTestDatabase, withTestTransaction } from "./setup"

describe("search_streams DM matching", () => {
  let pool: Pool

  beforeAll(async () => {
    pool = await setupTestDatabase()
  })

  afterAll(async () => {
    await pool.end()
  })

  test("matches DM by participant slug and returns viewer-specific DM name", async () => {
    await withTestTransaction(pool, async (client) => {
      const ownerWorkosUserId = userId()
      const peerWorkosUserId = userId()
      const testWorkspaceId = workspaceId()
      const dmId = streamId()

      await WorkspaceRepository.insert(client, {
        id: testWorkspaceId,
        name: "Search Streams DM Workspace",
        slug: `search-streams-dm-${testWorkspaceId}`,
        createdBy: ownerWorkosUserId,
      })

      const kristoffer = await UserRepository.insert(client, {
        id: userId(),
        workspaceId: testWorkspaceId,
        workosUserId: ownerWorkosUserId,
        email: `kristoffer.${testWorkspaceId.slice(-6)}@example.com`,
        slug: "kristoffer-remback",
        name: "Kristoffer",
        role: "owner",
      })
      const pierre = await UserRepository.insert(client, {
        id: userId(),
        workspaceId: testWorkspaceId,
        workosUserId: peerWorkosUserId,
        email: `pierre.${testWorkspaceId.slice(-6)}@example.com`,
        slug: "pierre-boberg",
        name: "Pierre Boberg",
        role: "user",
      })

      await StreamRepository.insert(client, {
        id: dmId,
        workspaceId: testWorkspaceId,
        type: StreamTypes.DM,
        visibility: Visibilities.PRIVATE,
        createdBy: kristoffer.id,
      })
      await StreamMemberRepository.insert(client, dmId, kristoffer.id)
      await StreamMemberRepository.insert(client, dmId, pierre.id)

      const kristofferTool = createSearchStreamsTool({
        db: client as unknown as Pool,
        workspaceId: testWorkspaceId,
        accessibleStreamIds: [dmId],
        invokingUserId: kristoffer.id,
        searchService: {} as never,
        storage: {} as never,
      })

      const kristofferResult = await kristofferTool.config.execute(
        { query: "Can you summarize my recent DMs with @pierre-boberg" },
        { toolCallId: "kristoffer" }
      )
      const kristofferParsed = JSON.parse(kristofferResult.output) as {
        results: Array<{ id: string; type: string; name: string }>
      }

      expect(kristofferParsed.results).toHaveLength(1)
      expect(kristofferParsed.results[0]).toMatchObject({
        id: dmId,
        type: StreamTypes.DM,
        name: "Pierre Boberg",
      })

      const pierreTool = createSearchStreamsTool({
        db: client as unknown as Pool,
        workspaceId: testWorkspaceId,
        accessibleStreamIds: [dmId],
        invokingUserId: pierre.id,
        searchService: {} as never,
        storage: {} as never,
      })

      const pierreResult = await pierreTool.config.execute(
        { query: "Summarize my recent DMs with @kristoffer-remback" },
        { toolCallId: "pierre" }
      )
      const pierreParsed = JSON.parse(pierreResult.output) as {
        results: Array<{ id: string; type: string; name: string }>
      }

      expect(pierreParsed.results).toHaveLength(1)
      expect(pierreParsed.results[0]).toMatchObject({
        id: dmId,
        type: StreamTypes.DM,
        name: "Kristoffer",
      })
    })
  })

  test("scratchpad context grants full user scope and can find DMs by @slug", async () => {
    await withTestTransaction(pool, async (client) => {
      const ownerWorkosUserId = userId()
      const peerWorkosUserId = userId()
      const outsiderWorkosUserId = userId()
      const testWorkspaceId = workspaceId()

      await WorkspaceRepository.insert(client, {
        id: testWorkspaceId,
        name: "Scratchpad DM Search Workspace",
        slug: `scratchpad-dm-search-${testWorkspaceId}`,
        createdBy: ownerWorkosUserId,
      })

      const kristoffer = await UserRepository.insert(client, {
        id: userId(),
        workspaceId: testWorkspaceId,
        workosUserId: ownerWorkosUserId,
        email: `kristoffer.${testWorkspaceId.slice(-6)}@example.com`,
        slug: "kristoffer-remback",
        name: "Kristoffer",
        role: "owner",
      })
      const pierre = await UserRepository.insert(client, {
        id: userId(),
        workspaceId: testWorkspaceId,
        workosUserId: peerWorkosUserId,
        email: `pierre.${testWorkspaceId.slice(-6)}@example.com`,
        slug: "pierre-boberg",
        name: "Pierre Boberg",
        role: "user",
      })
      const outsider = await UserRepository.insert(client, {
        id: userId(),
        workspaceId: testWorkspaceId,
        workosUserId: outsiderWorkosUserId,
        email: `outsider.${testWorkspaceId.slice(-6)}@example.com`,
        slug: "outsider-user",
        name: "Outsider User",
        role: "user",
      })

      const scratchpadId = streamId()
      await StreamRepository.insert(client, {
        id: scratchpadId,
        workspaceId: testWorkspaceId,
        type: StreamTypes.SCRATCHPAD,
        visibility: Visibilities.PRIVATE,
        createdBy: kristoffer.id,
        displayName: "My Scratchpad",
      })
      await StreamMemberRepository.insert(client, scratchpadId, kristoffer.id)

      const dmWithPierreId = streamId()
      await StreamRepository.insert(client, {
        id: dmWithPierreId,
        workspaceId: testWorkspaceId,
        type: StreamTypes.DM,
        visibility: Visibilities.PRIVATE,
        createdBy: kristoffer.id,
      })
      await StreamMemberRepository.insert(client, dmWithPierreId, kristoffer.id)
      await StreamMemberRepository.insert(client, dmWithPierreId, pierre.id)

      const dmWithOutsiderId = streamId()
      await StreamRepository.insert(client, {
        id: dmWithOutsiderId,
        workspaceId: testWorkspaceId,
        type: StreamTypes.DM,
        visibility: Visibilities.PRIVATE,
        createdBy: kristoffer.id,
      })
      await StreamMemberRepository.insert(client, dmWithOutsiderId, kristoffer.id)
      await StreamMemberRepository.insert(client, dmWithOutsiderId, outsider.id)

      const otherPrivateScratchpadId = streamId()
      await StreamRepository.insert(client, {
        id: otherPrivateScratchpadId,
        workspaceId: testWorkspaceId,
        type: StreamTypes.SCRATCHPAD,
        visibility: Visibilities.PRIVATE,
        createdBy: outsider.id,
        displayName: "Outsider Scratchpad",
      })
      await StreamMemberRepository.insert(client, otherPrivateScratchpadId, outsider.id)

      const scratchpad = await StreamRepository.findById(client, scratchpadId)
      expect(scratchpad).not.toBeNull()

      const accessSpec = await computeAgentAccessSpec(client, {
        stream: scratchpad!,
        invokingUserId: kristoffer.id,
      })

      expect(accessSpec.type).toBe("user_full_access")
      const accessibleStreamIds = await SearchRepository.getAccessibleStreamsForAgent(
        client,
        accessSpec,
        testWorkspaceId
      )

      expect(accessibleStreamIds).toContain(dmWithPierreId)
      expect(accessibleStreamIds).toContain(dmWithOutsiderId)
      expect(accessibleStreamIds).not.toContain(otherPrivateScratchpadId)

      const tool = createSearchStreamsTool({
        db: client as unknown as Pool,
        workspaceId: testWorkspaceId,
        accessibleStreamIds,
        invokingUserId: kristoffer.id,
        searchService: {} as never,
        storage: {} as never,
      })

      const result = await tool.config.execute(
        { query: "Can you summarize my recent DMs with @pierre-boberg" },
        { toolCallId: "scratchpad" }
      )
      const parsed = JSON.parse(result.output) as {
        results: Array<{ id: string; type: string; name: string }>
      }

      expect(parsed.results.some((stream) => stream.id === dmWithPierreId && stream.name === "Pierre Boberg")).toBe(
        true
      )
      expect(parsed.results.some((stream) => stream.id === dmWithOutsiderId)).toBe(false)
    })
  })

  test("matches DM by participant name with non-ASCII characters", async () => {
    await withTestTransaction(pool, async (client) => {
      const ownerWorkosUserId = userId()
      const peerWorkosUserId = userId()
      const testWorkspaceId = workspaceId()
      const dmId = streamId()

      await WorkspaceRepository.insert(client, {
        id: testWorkspaceId,
        name: "Unicode DM Search Workspace",
        slug: `unicode-dm-search-${testWorkspaceId}`,
        createdBy: ownerWorkosUserId,
      })

      const kristoffer = await UserRepository.insert(client, {
        id: userId(),
        workspaceId: testWorkspaceId,
        workosUserId: ownerWorkosUserId,
        email: `kristoffer.${testWorkspaceId.slice(-6)}@example.com`,
        slug: "kristoffer-remback",
        name: "Kristoffer",
        role: "owner",
      })
      const jose = await UserRepository.insert(client, {
        id: userId(),
        workspaceId: testWorkspaceId,
        workosUserId: peerWorkosUserId,
        email: `jose.${testWorkspaceId.slice(-6)}@example.com`,
        slug: "jose-alvarez",
        name: "José Álvarez",
        role: "user",
      })

      await StreamRepository.insert(client, {
        id: dmId,
        workspaceId: testWorkspaceId,
        type: StreamTypes.DM,
        visibility: Visibilities.PRIVATE,
        createdBy: kristoffer.id,
      })
      await StreamMemberRepository.insert(client, dmId, kristoffer.id)
      await StreamMemberRepository.insert(client, dmId, jose.id)

      const tool = createSearchStreamsTool({
        db: client as unknown as Pool,
        workspaceId: testWorkspaceId,
        accessibleStreamIds: [dmId],
        invokingUserId: kristoffer.id,
        searchService: {} as never,
        storage: {} as never,
      })

      const result = await tool.config.execute(
        { query: "Can you summarize my recent DMs with José?" },
        { toolCallId: "unicode" }
      )
      const parsed = JSON.parse(result.output) as {
        results: Array<{ id: string; type: string; name: string }>
      }

      expect(parsed.results).toHaveLength(1)
      expect(parsed.results[0]).toMatchObject({
        id: dmId,
        type: StreamTypes.DM,
        name: "José Álvarez",
      })
    })
  })

  test("interleaves DM and channel results by relevance so exact DM matches are not dropped", async () => {
    await withTestTransaction(pool, async (client) => {
      const ownerWorkosUserId = userId()
      const peerWorkosUserId = userId()
      const testWorkspaceId = workspaceId()

      await WorkspaceRepository.insert(client, {
        id: testWorkspaceId,
        name: "Interleaving Search Workspace",
        slug: `interleaving-search-${testWorkspaceId}`,
        createdBy: ownerWorkosUserId,
      })

      const kristoffer = await UserRepository.insert(client, {
        id: userId(),
        workspaceId: testWorkspaceId,
        workosUserId: ownerWorkosUserId,
        email: `kristoffer.${testWorkspaceId.slice(-6)}@example.com`,
        slug: "kristoffer-remback",
        name: "Kristoffer",
        role: "owner",
      })
      const testPeer = await UserRepository.insert(client, {
        id: userId(),
        workspaceId: testWorkspaceId,
        workosUserId: peerWorkosUserId,
        email: `testpeer.${testWorkspaceId.slice(-6)}@example.com`,
        slug: "testy-user",
        name: "Test",
        role: "user",
      })

      const dmId = streamId()
      await StreamRepository.insert(client, {
        id: dmId,
        workspaceId: testWorkspaceId,
        type: StreamTypes.DM,
        visibility: Visibilities.PRIVATE,
        createdBy: kristoffer.id,
      })
      await StreamMemberRepository.insert(client, dmId, kristoffer.id)
      await StreamMemberRepository.insert(client, dmId, testPeer.id)

      const channelIds: string[] = []
      for (let index = 0; index < 12; index += 1) {
        const channelId = streamId()
        channelIds.push(channelId)
        await StreamRepository.insert(client, {
          id: channelId,
          workspaceId: testWorkspaceId,
          type: StreamTypes.CHANNEL,
          visibility: Visibilities.PUBLIC,
          slug: `test-channel-${index}`,
          displayName: `Test channel ${index}`,
          createdBy: kristoffer.id,
        })
      }

      const tool = createSearchStreamsTool({
        db: client as unknown as Pool,
        workspaceId: testWorkspaceId,
        accessibleStreamIds: [dmId, ...channelIds],
        invokingUserId: kristoffer.id,
        searchService: {} as never,
        storage: {} as never,
      })

      const result = await tool.config.execute({ query: "test" }, { toolCallId: "interleave" })
      const parsed = JSON.parse(result.output) as {
        results: Array<{ id: string; type: string; name: string }>
      }

      expect(parsed.results).toHaveLength(10)
      expect(parsed.results[0]).toMatchObject({
        id: dmId,
        type: StreamTypes.DM,
        name: "Test",
      })
    })
  })

  test("listDmPeersForMember fails closed when stream scope is explicitly empty", async () => {
    await withTestTransaction(pool, async (client) => {
      const ownerWorkosUserId = userId()
      const peerWorkosUserId = userId()
      const testWorkspaceId = workspaceId()
      const dmId = streamId()

      await WorkspaceRepository.insert(client, {
        id: testWorkspaceId,
        name: "Scoped DM Peers Workspace",
        slug: `scoped-dm-peers-${testWorkspaceId}`,
        createdBy: ownerWorkosUserId,
      })

      const kristoffer = await UserRepository.insert(client, {
        id: userId(),
        workspaceId: testWorkspaceId,
        workosUserId: ownerWorkosUserId,
        email: `kristoffer.${testWorkspaceId.slice(-6)}@example.com`,
        slug: "kristoffer-remback",
        name: "Kristoffer",
        role: "owner",
      })
      const pierre = await UserRepository.insert(client, {
        id: userId(),
        workspaceId: testWorkspaceId,
        workosUserId: peerWorkosUserId,
        email: `pierre.${testWorkspaceId.slice(-6)}@example.com`,
        slug: "pierre-boberg",
        name: "Pierre Boberg",
        role: "user",
      })

      await StreamRepository.insert(client, {
        id: dmId,
        workspaceId: testWorkspaceId,
        type: StreamTypes.DM,
        visibility: Visibilities.PRIVATE,
        createdBy: kristoffer.id,
      })
      await StreamMemberRepository.insert(client, dmId, kristoffer.id)
      await StreamMemberRepository.insert(client, dmId, pierre.id)

      const peers = await StreamRepository.listDmPeersForMember(client, testWorkspaceId, kristoffer.id, {
        streamIds: [],
      })
      expect(peers).toEqual([])
    })
  })
})
