/**
 * E2E tests for slash command visibility.
 *
 * Verifies that command events (dispatched, completed, failed) are only
 * visible to the user who dispatched them, not other channel members.
 */

import { describe, test, expect } from "bun:test"
import {
  TestClient,
  loginAs,
  createWorkspace,
  createChannel,
  joinWorkspace,
  joinStream,
  dispatchCommand,
  getBootstrap,
  listEvents,
  getMemberId,
} from "../client"

const testRunId = Math.random().toString(36).substring(7)
const testEmail = (name: string) => `${name}-${testRunId}@test.com`

describe("Command Visibility E2E", () => {
  test("command events are only visible to the command author via bootstrap", async () => {
    // Setup: Create two users in the same workspace and channel
    const clientA = new TestClient()
    const clientB = new TestClient()

    const userA = await loginAs(clientA, testEmail("cmd-vis-a"), "User A")
    const userB = await loginAs(clientB, testEmail("cmd-vis-b"), "User B")

    // User A creates workspace and channel
    const workspace = await createWorkspace(clientA, `Cmd Vis WS ${testRunId}`)
    const channel = await createChannel(clientA, workspace.id, `cmd-vis-${testRunId}`, "public")

    // User B joins workspace and channel
    await joinWorkspace(clientB, workspace.id)
    await joinStream(clientB, workspace.id, channel.id)

    // User A dispatches a command
    const cmdResult = await dispatchCommand(clientA, workspace.id, channel.id, "/simulate test scenario")
    expect(cmdResult.success).toBe(true)
    expect(cmdResult.command).toBe("simulate")
    expect(cmdResult.args).toBe("test scenario")

    // User A fetches bootstrap - should see command_dispatched event
    const bootstrapA = await getBootstrap(clientA, workspace.id, channel.id)
    const eventTypesA = bootstrapA.events.map((e) => e.eventType)
    expect(eventTypesA).toContain("command_dispatched")

    // Verify the command event has correct actor (member ID, not user ID)
    const memberIdA = await getMemberId(clientA, workspace.id, userA.id)
    const cmdEventA = bootstrapA.events.find((e) => e.eventType === "command_dispatched")
    expect(cmdEventA?.actorId).toBe(memberIdA)

    // User B fetches bootstrap - should NOT see command events
    const bootstrapB = await getBootstrap(clientB, workspace.id, channel.id)
    const eventTypesB = bootstrapB.events.map((e) => e.eventType)
    expect(eventTypesB).not.toContain("command_dispatched")
    expect(eventTypesB).not.toContain("command_completed")
    expect(eventTypesB).not.toContain("command_failed")
  })

  test("command events are only visible to the command author via listEvents", async () => {
    const clientA = new TestClient()
    const clientB = new TestClient()

    await loginAs(clientA, testEmail("cmd-list-a"), "User A")
    await loginAs(clientB, testEmail("cmd-list-b"), "User B")

    const workspace = await createWorkspace(clientA, `Cmd List WS ${testRunId}`)
    const channel = await createChannel(clientA, workspace.id, `cmd-list-${testRunId}`, "public")

    await joinWorkspace(clientB, workspace.id)
    await joinStream(clientB, workspace.id, channel.id)

    // User A dispatches a command
    await dispatchCommand(clientA, workspace.id, channel.id, "/simulate another test")

    // User A lists events - should see command events
    const eventsA = await listEvents(clientA, workspace.id, channel.id)
    const eventTypesA = eventsA.map((e) => e.eventType)
    expect(eventTypesA).toContain("command_dispatched")

    // User B lists events - should NOT see command events
    const eventsB = await listEvents(clientB, workspace.id, channel.id)
    const eventTypesB = eventsB.map((e) => e.eventType)
    expect(eventTypesB).not.toContain("command_dispatched")
  })

  test("each user only sees their own command events", async () => {
    const clientA = new TestClient()
    const clientB = new TestClient()

    const userA = await loginAs(clientA, testEmail("cmd-both-a"), "User A")
    const userB = await loginAs(clientB, testEmail("cmd-both-b"), "User B")

    const workspace = await createWorkspace(clientA, `Cmd Both WS ${testRunId}`)
    const channel = await createChannel(clientA, workspace.id, `cmd-both-${testRunId}`, "public")

    await joinWorkspace(clientB, workspace.id)
    await joinStream(clientB, workspace.id, channel.id)

    // Both users dispatch commands
    const cmdA = await dispatchCommand(clientA, workspace.id, channel.id, "/simulate from A")
    const cmdB = await dispatchCommand(clientB, workspace.id, channel.id, "/simulate from B")

    // Resolve member IDs for comparison
    const memberIdA = await getMemberId(clientA, workspace.id, userA.id)
    const memberIdB = await getMemberId(clientB, workspace.id, userB.id)

    // User A's bootstrap should only show their command
    const bootstrapA = await getBootstrap(clientA, workspace.id, channel.id)
    const cmdEventsA = bootstrapA.events.filter((e) => e.eventType === "command_dispatched")
    expect(cmdEventsA.length).toBe(1)
    expect(cmdEventsA[0].actorId).toBe(memberIdA)
    expect((cmdEventsA[0].payload as { commandId: string }).commandId).toBe(cmdA.commandId)

    // User B's bootstrap should only show their command
    const bootstrapB = await getBootstrap(clientB, workspace.id, channel.id)
    const cmdEventsB = bootstrapB.events.filter((e) => e.eventType === "command_dispatched")
    expect(cmdEventsB.length).toBe(1)
    expect(cmdEventsB[0].actorId).toBe(memberIdB)
    expect((cmdEventsB[0].payload as { commandId: string }).commandId).toBe(cmdB.commandId)
  })
})
