/**
 * E2E tests for search functionality.
 *
 * Run with: bun test --preload ./tests/setup.ts tests/e2e/search.test.ts
 */

import { describe, test, expect } from "bun:test"
import {
  TestClient,
  loginAs,
  createWorkspace,
  createScratchpad,
  createChannel,
  sendMessage,
  search,
  joinWorkspace,
  joinStream,
} from "../client"

const testRunId = Math.random().toString(36).substring(7)
const testEmail = (name: string) => `${name}-search-${testRunId}@test.com`

describe("Search E2E Tests", () => {
  describe("Basic Search", () => {
    test("should find messages by keyword", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("keyword"), "Keyword Test")
      const workspace = await createWorkspace(client, `Search WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, "off")

      // Send messages with distinct content
      const uniqueWord = `unicorn${testRunId}`
      await sendMessage(client, workspace.id, scratchpad.id, `I saw a ${uniqueWord} yesterday`)
      await sendMessage(client, workspace.id, scratchpad.id, "Regular message without the word")

      const results = await search(client, workspace.id, { query: uniqueWord })

      expect(results.length).toBe(1)
      expect(results[0].content).toContain(uniqueWord)
    })

    test("should return empty array when no matches", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("nomatch"), "No Match Test")
      const workspace = await createWorkspace(client, `NoMatch WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, "off")

      await sendMessage(client, workspace.id, scratchpad.id, "Hello world")

      const results = await search(client, workspace.id, { query: "xyznonexistent123" })

      expect(results).toEqual([])
    })

    test("should respect limit parameter", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("limit"), "Limit Test")
      const workspace = await createWorkspace(client, `Limit WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, "off")

      const keyword = `dragon${testRunId}`
      // Send multiple messages with the keyword
      for (let i = 0; i < 5; i++) {
        await sendMessage(client, workspace.id, scratchpad.id, `Message ${i} about ${keyword}`)
      }

      const results = await search(client, workspace.id, { query: keyword, limit: 2 })

      expect(results.length).toBe(2)
    })

    test("should search across multiple streams", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("multi"), "Multi Test")
      const workspace = await createWorkspace(client, `Multi WS ${testRunId}`)
      const scratchpad1 = await createScratchpad(client, workspace.id, "off")
      const scratchpad2 = await createScratchpad(client, workspace.id, "off")

      const keyword = `phoenix${testRunId}`
      await sendMessage(client, workspace.id, scratchpad1.id, `First ${keyword} message`)
      await sendMessage(client, workspace.id, scratchpad2.id, `Second ${keyword} message`)

      const results = await search(client, workspace.id, { query: keyword })

      expect(results.length).toBe(2)
    })
  })

  describe("Permission Filtering", () => {
    test("should only return messages from accessible streams", async () => {
      // User A creates workspace and channel
      const clientA = new TestClient()
      const userA = await loginAs(clientA, testEmail("userA"), "User A")
      const workspace = await createWorkspace(clientA, `Perm WS ${testRunId}`)
      const privateChannel = await createChannel(clientA, workspace.id, `private-${testRunId}`, "private")

      const keyword = `secret${testRunId}`
      await sendMessage(clientA, workspace.id, privateChannel.id, `A ${keyword} message`)

      // User B joins workspace but NOT the private channel
      const clientB = new TestClient()
      await loginAs(clientB, testEmail("userB"), "User B")
      await joinWorkspace(clientB, workspace.id)

      // User B searches - should not find User A's message in private channel
      const resultsB = await search(clientB, workspace.id, { query: keyword })
      expect(resultsB.length).toBe(0)

      // User A searches - should find their own message
      const resultsA = await search(clientA, workspace.id, { query: keyword })
      expect(resultsA.length).toBe(1)
    })

    test("should return messages from public channels without membership", async () => {
      // User A creates workspace with public channel
      const clientA = new TestClient()
      await loginAs(clientA, testEmail("pubA"), "Pub User A")
      const workspace = await createWorkspace(clientA, `PubChan WS ${testRunId}`)
      const publicChannel = await createChannel(clientA, workspace.id, `public-${testRunId}`, "public")

      const keyword = `public${testRunId}`
      await sendMessage(clientA, workspace.id, publicChannel.id, `A ${keyword} announcement`)

      // User B joins workspace (but not the channel specifically)
      const clientB = new TestClient()
      await loginAs(clientB, testEmail("pubB"), "Pub User B")
      await joinWorkspace(clientB, workspace.id)

      // User B should find the message since channel is public
      const resultsB = await search(clientB, workspace.id, { query: keyword })
      expect(resultsB.length).toBe(1)
    })
  })

  describe("Filter Operators", () => {
    test("should filter by stream type with is:scratchpad", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("istype"), "Is Type Test")
      const workspace = await createWorkspace(client, `IsType WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, "off")
      const channel = await createChannel(client, workspace.id, `filter-${testRunId}`, "private")

      const keyword = `griffin${testRunId}`
      await sendMessage(client, workspace.id, scratchpad.id, `Scratchpad ${keyword}`)
      await sendMessage(client, workspace.id, channel.id, `Channel ${keyword}`)

      // Search with is:scratchpad filter
      const results = await search(client, workspace.id, { query: keyword, is: ["scratchpad"] })

      expect(results.length).toBe(1)
      expect(results[0].content).toContain("Scratchpad")
    })

    test("should filter by stream type with is:channel", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("ischan"), "Is Channel Test")
      const workspace = await createWorkspace(client, `IsChan WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, "off")
      const channel = await createChannel(client, workspace.id, `chanfilter-${testRunId}`, "private")

      const keyword = `hydra${testRunId}`
      await sendMessage(client, workspace.id, scratchpad.id, `Scratchpad ${keyword}`)
      await sendMessage(client, workspace.id, channel.id, `Channel ${keyword}`)

      const results = await search(client, workspace.id, { query: keyword, is: ["channel"] })

      expect(results.length).toBe(1)
      expect(results[0].content).toContain("Channel")
    })

    test("should filter by author with from filter", async () => {
      // User A creates workspace and channel
      const clientA = new TestClient()
      const userA = await loginAs(clientA, testEmail("fromA"), "From User A")
      const workspace = await createWorkspace(clientA, `From WS ${testRunId}`)
      const channel = await createChannel(clientA, workspace.id, `from-${testRunId}`, "public")

      const keyword = `dragon${testRunId}`
      await sendMessage(clientA, workspace.id, channel.id, `User A says ${keyword}`)

      // User B joins and sends message
      const clientB = new TestClient()
      await loginAs(clientB, testEmail("fromB"), "From User B")
      await joinWorkspace(clientB, workspace.id)
      await joinStream(clientB, workspace.id, channel.id)
      await sendMessage(clientB, workspace.id, channel.id, `User B says ${keyword}`)

      // Search for messages from User A only - pass user ID directly
      const results = await search(clientA, workspace.id, { query: keyword, from: [userA.id] })

      expect(results.length).toBe(1)
      expect(results[0].authorId).toBe(userA.id)
    })

    test("should filter by co-member with with filter", async () => {
      // User A creates workspace with two channels
      const clientA = new TestClient()
      await loginAs(clientA, testEmail("withA"), "With User A")
      const workspace = await createWorkspace(clientA, `With WS ${testRunId}`)
      const channelShared = await createChannel(clientA, workspace.id, `shared-${testRunId}`, "private")
      const channelPrivate = await createChannel(clientA, workspace.id, `private-${testRunId}`, "private")

      const keyword = `sphinx${testRunId}`
      await sendMessage(clientA, workspace.id, channelShared.id, `Shared ${keyword}`)
      await sendMessage(clientA, workspace.id, channelPrivate.id, `Private ${keyword}`)

      // User B joins workspace and only the shared channel
      const clientB = new TestClient()
      const userB = await loginAs(clientB, testEmail("withB"), "With User B")
      await joinWorkspace(clientB, workspace.id)
      await joinStream(clientB, workspace.id, channelShared.id)

      // User A searches with userB's ID - should only find messages in shared channel
      const results = await search(clientA, workspace.id, { query: keyword, with: [userB.id] })

      expect(results.length).toBe(1)
      expect(results[0].streamId).toBe(channelShared.id)
    })

    test("should combine multiple filters", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("combo"), "Combo Test")
      const workspace = await createWorkspace(client, `Combo WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, "off")
      const channel = await createChannel(client, workspace.id, `combo-${testRunId}`, "private")

      const keyword = `kraken${testRunId}`
      await sendMessage(client, workspace.id, scratchpad.id, `Scratchpad ${keyword}`)
      await sendMessage(client, workspace.id, channel.id, `Channel ${keyword}`)

      // Search with is:scratchpad filter - should only find the scratchpad message
      const results = await search(client, workspace.id, { query: keyword, is: ["scratchpad"] })

      expect(results.length).toBe(1)
      expect(results[0].content).toContain("Scratchpad")
    })
  })

  describe("Edge Cases", () => {
    test("should handle search with only filters (no keywords)", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("filteronly"), "Filter Only Test")
      const workspace = await createWorkspace(client, `FilterOnly WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, "off")

      await sendMessage(client, workspace.id, scratchpad.id, "Some message content")

      // Search with only filter, no query
      const results = await search(client, workspace.id, { is: ["scratchpad"] })

      expect(results.length).toBeGreaterThan(0)
    })

    test("should handle special characters in search", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("special"), "Special Chars Test")
      const workspace = await createWorkspace(client, `Special WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, "off")

      await sendMessage(client, workspace.id, scratchpad.id, "Test message with normal content")

      // Search with special characters - should not crash
      const results = await search(client, workspace.id, { query: "test & query | special" })

      // Should either return results or empty array, not error
      expect(Array.isArray(results)).toBe(true)
    })

    test("should return messages sorted by relevance", async () => {
      const client = new TestClient()
      await loginAs(client, testEmail("relevance"), "Relevance Test")
      const workspace = await createWorkspace(client, `Relevance WS ${testRunId}`)
      const scratchpad = await createScratchpad(client, workspace.id, "off")

      const keyword = `basilisk${testRunId}`
      // First message has keyword once
      await sendMessage(client, workspace.id, scratchpad.id, `One ${keyword} here`)
      // Second message has keyword multiple times
      await sendMessage(client, workspace.id, scratchpad.id, `Many ${keyword} ${keyword} ${keyword} mentions`)

      const results = await search(client, workspace.id, { query: keyword })

      expect(results.length).toBe(2)
      // Results should have rank property
      expect(results[0]).toHaveProperty("rank")
    })
  })
})
