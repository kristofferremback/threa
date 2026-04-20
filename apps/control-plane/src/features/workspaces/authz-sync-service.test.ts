import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { ControlPlaneAuthzSyncService } from "./authz-sync-service"
import { ControlPlaneAuthzMirrorRepository } from "./authz-mirror-repository"
import { WorkspaceRegistryRepository } from "./repository"

describe("ControlPlaneAuthzSyncService", () => {
  const tryAcquireLease = spyOn(ControlPlaneAuthzMirrorRepository, "tryAcquireLease")
  const releaseLease = spyOn(ControlPlaneAuthzMirrorRepository, "releaseLease")
  const hasRecordedEvent = spyOn(ControlPlaneAuthzMirrorRepository, "hasRecordedEvent")
  const recordEvent = spyOn(ControlPlaneAuthzMirrorRepository, "recordEvent")
  const getSnapshot = spyOn(ControlPlaneAuthzMirrorRepository, "getSnapshot")
  const findByWorkosOrganizationId = spyOn(WorkspaceRegistryRepository, "findByWorkosOrganizationId")

  afterEach(() => {
    tryAcquireLease.mockReset()
    releaseLease.mockReset()
    hasRecordedEvent.mockReset()
    recordEvent.mockReset()
    getSnapshot.mockReset()
    findByWorkosOrganizationId.mockReset()
  })

  test("records unknown-org events as skipped and advances the cursor", async () => {
    tryAcquireLease.mockResolvedValue({ cursor: null } as never)
    releaseLease.mockResolvedValue(undefined as never)
    hasRecordedEvent.mockResolvedValue(false as never)
    recordEvent.mockResolvedValue(true as never)
    findByWorkosOrganizationId.mockResolvedValue(null as never)

    const workosOrgService = {
      listEvents: mock(async () => ({
        data: [
          {
            id: "evt_1",
            event: "organization_membership.created",
            createdAt: "2026-04-19T20:00:37Z",
            data: { organizationId: "org_unknown" },
          },
        ],
        after: "cursor_1",
      })),
    } as any

    const service = new ControlPlaneAuthzSyncService({
      pool: {} as never,
      workosOrgService,
      regionalClient: {} as never,
    })

    await service.pollEvents()

    expect(recordEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventId: "evt_1",
        organizationId: "org_unknown",
        status: "skipped_unknown_org",
      })
    )
    expect(releaseLease).toHaveBeenCalledWith(expect.anything(), "workos_authz_events", expect.any(String), "evt_1")
  })

  test("skips events that were already recorded", async () => {
    tryAcquireLease.mockResolvedValue({ cursor: "evt_0" } as never)
    releaseLease.mockResolvedValue(undefined as never)
    hasRecordedEvent.mockResolvedValue(true as never)

    const workosOrgService = {
      listEvents: mock(async () => ({
        data: [
          {
            id: "evt_1",
            event: "organization_membership.created",
            createdAt: "2026-04-19T20:00:37Z",
            data: { organizationId: "org_unknown" },
          },
        ],
        after: null,
      })),
    } as any

    const service = new ControlPlaneAuthzSyncService({
      pool: {} as never,
      workosOrgService,
      regionalClient: {} as never,
    })

    await service.pollEvents()

    expect(recordEvent).not.toHaveBeenCalled()
    expect(findByWorkosOrganizationId).not.toHaveBeenCalled()
    expect(releaseLease).toHaveBeenCalledWith(expect.anything(), "workos_authz_events", expect.any(String), "evt_1")
  })

  test("dispatches the full canonical snapshot to the owning region", async () => {
    const snapshot = {
      workspaceId: "ws_1",
      workosOrganizationId: "org_1",
      revision: "3",
      generatedAt: "2026-04-19T20:00:37Z",
      roles: [],
      memberships: [],
    }
    getSnapshot.mockResolvedValue(snapshot as never)

    const regionalClient = {
      applyWorkspaceAuthzSnapshot: mock(async () => ({ applied: true })),
    } as any

    const service = new ControlPlaneAuthzSyncService({
      pool: {} as never,
      workosOrgService: {} as never,
      regionalClient,
    })

    await service.dispatchRegionalSync({ workspaceId: "ws_1", region: "eu" })

    expect(regionalClient.applyWorkspaceAuthzSnapshot).toHaveBeenCalledWith("eu", "ws_1", snapshot)
  })
})
