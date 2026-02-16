import { Pool } from "pg"
import { withTransaction } from "../../db"
import { WorkspaceRepository } from "./repository"
import { MemberRepository } from "./member-repository"
import { AvatarUploadRepository } from "./avatar-upload-repository"
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
    const { avatarUploadId } = job.data

    // Phase 1: Read upload row (fast)
    const upload = await AvatarUploadRepository.findById(pool, avatarUploadId)
    if (!upload) {
      logger.info({ jobId: job.id, avatarUploadId }, "Upload row gone (removed or superseded), skipping")
      return
    }

    const { workspaceId, memberId, rawS3Key, replacesAvatarUrl } = upload

    logger.info({ jobId: job.id, avatarUploadId, memberId }, "Processing avatar job")

    // Phase 2: Download raw from S3 (no DB connection — INV-41)
    const buffer = await avatarService.downloadRaw(rawS3Key)

    // Phase 3: Process images (no DB connection)
    const timestamp = rawS3Key.split("/").pop()!.replace(".original", "")
    const basePath = `avatars/${workspaceId}/${memberId}/${timestamp}`
    const images = await avatarService.processImages(buffer)

    // Phase 4: Upload variants to S3 (no DB connection)
    await avatarService.uploadImages(basePath, images)

    // Phase 5: Transaction — update member if this is still the latest upload
    await withTransaction(pool, async (client) => {
      // Re-read upload row inside transaction to check it still exists
      const currentUpload = await AvatarUploadRepository.findById(client, avatarUploadId)
      if (!currentUpload) {
        logger.info({ jobId: job.id, avatarUploadId }, "Upload row gone during processing, skipping")
        return
      }

      // Check if this is the latest upload for this member
      const latest = await AvatarUploadRepository.findLatestForMember(client, memberId)
      const isLatest = latest?.id === avatarUploadId

      if (isLatest) {
        await WorkspaceRepository.updateMember(client, memberId, { avatarUrl: basePath })

        const fullMember = await MemberRepository.findById(client, memberId)
        if (fullMember) {
          await OutboxRepository.insert(client, "member:updated", {
            workspaceId,
            member: serializeBigInt(fullMember),
          })
        }
      } else {
        logger.info(
          { jobId: job.id, avatarUploadId, latestId: latest?.id },
          "Newer upload exists, skipping member update"
        )
      }

      // Delete our upload row regardless — processing is done
      await AvatarUploadRepository.deleteById(client, avatarUploadId)
    })

    // Fire-and-forget cleanup: raw file + old avatar
    avatarService.deleteRawFile(rawS3Key)
    if (replacesAvatarUrl) {
      avatarService.deleteAvatarFiles(replacesAvatarUrl)
    }

    logger.info({ jobId: job.id, avatarUploadId, memberId }, "Avatar processing completed")
  }
}

export function createAvatarProcessOnDLQ(deps: AvatarProcessWorkerDeps): OnDLQHook<AvatarProcessJobData> {
  return async (querier, job, error) => {
    const { avatarUploadId } = job.data
    logger.warn(
      { jobId: job.id, avatarUploadId, error: error.message },
      "Avatar processing moved to DLQ, deleting upload row"
    )

    // Delete the upload row — raw S3 file is kept for debugging/reprocessing
    await AvatarUploadRepository.deleteById(querier, avatarUploadId)
  }
}
