import type { Pool } from "pg"
import { OutboxRepository, isOneOfOutboxEventType } from "../../lib/outbox"
import { logger } from "../../lib/logger"
import { CursorLock, ensureListenerFromLatest, type ProcessResult } from "../../lib/cursor-lock"
import { DebounceWithMaxWait } from "../../lib/debounce"
import type { OutboxHandler } from "../../lib/outbox"
import type { ControlPlaneClient } from "../../lib/control-plane-client"
import { InvitationRepository } from "./repository"

const DEFAULT_CONFIG = {
  batchSize: 100,
  debounceMs: 50,
  maxWaitMs: 200,
  lockDurationMs: 10_000,
  refreshIntervalMs: 5_000,
  maxRetries: 5,
  baseBackoffMs: 1_000,
}

/**
 * Syncs invitation lifecycle events to the control-plane as shadows.
 * Handles invitation:sent (create shadow) and invitation:revoked (revoke shadow).
 */
export class InvitationShadowSyncHandler implements OutboxHandler {
  readonly listenerId = "invitation-shadow-sync"

  private readonly db: Pool
  private readonly controlPlaneClient: ControlPlaneClient
  private readonly region: string
  private readonly cursorLock: CursorLock
  private readonly debouncer: DebounceWithMaxWait
  private readonly batchSize: number

  constructor(db: Pool, controlPlaneClient: ControlPlaneClient, region: string) {
    this.db = db
    this.controlPlaneClient = controlPlaneClient
    this.region = region
    this.batchSize = DEFAULT_CONFIG.batchSize

    this.cursorLock = new CursorLock({
      pool: db,
      listenerId: this.listenerId,
      lockDurationMs: DEFAULT_CONFIG.lockDurationMs,
      refreshIntervalMs: DEFAULT_CONFIG.refreshIntervalMs,
      maxRetries: DEFAULT_CONFIG.maxRetries,
      baseBackoffMs: DEFAULT_CONFIG.baseBackoffMs,
      batchSize: this.batchSize,
    })

    this.debouncer = new DebounceWithMaxWait(
      () => this.processEvents(),
      DEFAULT_CONFIG.debounceMs,
      DEFAULT_CONFIG.maxWaitMs,
      (err) => logger.error({ err, listenerId: this.listenerId }, "InvitationShadowSyncHandler debouncer error")
    )
  }

  async ensureListener(): Promise<void> {
    await ensureListenerFromLatest(this.db, this.listenerId)
  }

  handle(): void {
    this.debouncer.trigger()
  }

  private async processEvents(): Promise<void> {
    await this.cursorLock.run(async (cursor, processedIds): Promise<ProcessResult> => {
      const events = await OutboxRepository.fetchAfterId(this.db, cursor, this.batchSize, processedIds)

      if (events.length === 0) {
        return { status: "no_events" }
      }

      const seen: bigint[] = []

      try {
        for (const event of events) {
          if (!isOneOfOutboxEventType(event, ["invitation:sent", "invitation:revoked"])) {
            seen.push(event.id)
            continue
          }

          if (event.eventType === "invitation:sent") {
            const { invitationId, workspaceId } = event.payload
            const invitation = await InvitationRepository.findById(this.db, invitationId)
            if (!invitation) {
              logger.warn({ invitationId }, "Invitation not found for shadow sync, skipping")
              seen.push(event.id)
              continue
            }

            await this.controlPlaneClient.createInvitationShadow({
              id: invitation.id,
              workspaceId,
              email: invitation.email,
              region: this.region,
              expiresAt: invitation.expiresAt,
            })
          } else if (event.eventType === "invitation:revoked") {
            const { invitationId } = event.payload
            await this.controlPlaneClient.revokeInvitationShadow(invitationId)
          }

          seen.push(event.id)
        }

        return { status: "processed", processedIds: seen }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))

        if (seen.length > 0) {
          return { status: "error", error, processedIds: seen }
        }

        return { status: "error", error }
      }
    })
  }
}
