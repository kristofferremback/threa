import { Pool } from "pg"
import { withTransaction } from "../../db"
import { WorkspaceRepository } from "./repository"
import { MemberRepository } from "./member-repository"
import { OutboxRepository } from "../../lib/outbox"
import { serializeBigInt } from "../../lib/serialization"
import { logger } from "../../lib/logger"
import type { AvatarProcessJobData, JobHandler, OnDLQHook } from "../../lib/queue"
import type { AvatarService } from "./avatar-service"

export interface AvatarProcessWorkerDeps {
  pool: Pool
  avatarService: AvatarService
}

export function createAvatarProcessWorker(deps: AvatarProcessWorkerDeps): JobHandler<AvatarProcessJobData> {
  const { pool, avatarService } = deps

  return async (job) => {
    const { workspaceId, memberId, rawS3Key, oldAvatarUrl } = job.data

    logger.info({ jobId: job.id, memberId }, "Processing avatar job")

    // Phase 1: Download raw from S3 (no DB connection — INV-41)
    const buffer = await avatarService.downloadRaw(rawS3Key)

    // Phase 2: Process images (no DB connection)
    const timestamp = rawS3Key.split("/").pop()!.replace(".original", "")
    const basePath = `avatars/${workspaceId}/${memberId}/${timestamp}`
    const images = await avatarService.processImages(buffer)

    // Phase 3: Upload variants to S3 (no DB connection)
    await avatarService.uploadImages(basePath, images)

    // Phase 4: Transaction — update avatar URL + clear status
    await withTransaction(pool, async (client) => {
      const currentMember = await MemberRepository.findById(client, memberId)

      // Race guard: if status isn't 'processing', a concurrent remove or newer upload won.
      if (!currentMember || currentMember.avatarStatus !== "processing") {
        logger.info(
          { jobId: job.id, memberId, avatarStatus: currentMember?.avatarStatus },
          "Avatar status changed, skipping update"
        )
        return
      }

      await WorkspaceRepository.updateMember(client, memberId, {
        avatarUrl: basePath,
        avatarStatus: null,
      })

      const fullMember = await MemberRepository.findById(client, memberId)
      if (fullMember) {
        await OutboxRepository.insert(client, "member:updated", {
          workspaceId,
          member: serializeBigInt(fullMember),
        })
      }
    })

    // Fire-and-forget cleanup: raw file + old avatar
    avatarService.deleteRawFile(rawS3Key)
    if (oldAvatarUrl) {
      avatarService.deleteAvatarFiles(oldAvatarUrl)
    }

    logger.info({ jobId: job.id, memberId }, "Avatar processing completed")
  }
}

export function createAvatarProcessOnDLQ(deps: AvatarProcessWorkerDeps): OnDLQHook<AvatarProcessJobData> {
  const { pool } = deps

  return async (querier, job, error) => {
    const { workspaceId, memberId } = job.data
    logger.warn({ jobId: job.id, memberId, error: error.message }, "Avatar processing moved to DLQ, clearing status")

    await WorkspaceRepository.updateMember(querier, memberId, { avatarStatus: null })

    const fullMember = await MemberRepository.findById(querier, memberId)
    if (fullMember) {
      await OutboxRepository.insert(querier, "member:updated", {
        workspaceId,
        member: serializeBigInt(fullMember),
      })
    }
  }
}
