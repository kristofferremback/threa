import { Pool } from "pg"
import { withTransaction } from "../../db"
import { WorkspaceRepository } from "./repository"
import { MemberRepository } from "./member-repository"
import { AvatarUploadRepository } from "./avatar-upload-repository"
import { OutboxRepository } from "../../lib/outbox"
import { serializeBigInt } from "../../lib/serialization"
import { logger } from "../../lib/logger"
import type { AvatarService } from "./avatar-service"

export class AvatarProcessingService {
  private pool: Pool
  private avatarService: AvatarService

  constructor(pool: Pool, avatarService: AvatarService) {
    this.pool = pool
    this.avatarService = avatarService
  }

  async processUpload(avatarUploadId: string): Promise<void> {
    // Phase 1: Read upload row (fast)
    const upload = await AvatarUploadRepository.findById(this.pool, avatarUploadId)
    if (!upload) {
      logger.info({ avatarUploadId }, "Upload row gone (removed or superseded), skipping")
      return
    }

    const { workspaceId, memberId, rawS3Key, replacesAvatarUrl } = upload

    logger.info({ avatarUploadId, memberId }, "Processing avatar")

    // Phase 2: Download raw from S3 (no DB connection — INV-41)
    const buffer = await this.avatarService.downloadRaw(rawS3Key)

    // Phase 3: Process images + upload variants (no DB connection)
    const basePath = this.avatarService.rawKeyToBasePath(rawS3Key)
    const images = await this.avatarService.processImages(buffer)
    await this.avatarService.uploadImages(basePath, images)

    // Phase 4: Transaction — update member if this is still the latest upload
    let variantsUsed = false
    await withTransaction(this.pool, async (client) => {
      const currentUpload = await AvatarUploadRepository.findById(client, avatarUploadId)
      if (!currentUpload) {
        logger.info({ avatarUploadId }, "Upload row gone during processing, skipping")
        return
      }

      const latest = await AvatarUploadRepository.findLatestForMember(client, memberId)
      const isLatest = latest?.id === avatarUploadId

      if (isLatest) {
        variantsUsed = true
        await WorkspaceRepository.updateMember(client, memberId, { avatarUrl: basePath })

        const fullMember = await MemberRepository.findById(client, memberId)
        if (fullMember) {
          await OutboxRepository.insert(client, "member:updated", {
            workspaceId,
            member: serializeBigInt(fullMember),
          })
        }
      } else {
        logger.info({ avatarUploadId, latestId: latest?.id }, "Newer upload exists, skipping member update")
      }

      // Delete our upload row regardless — processing is done
      await AvatarUploadRepository.deleteById(client, avatarUploadId)
    })

    // Fire-and-forget cleanup: raw file always, variants + old avatar only if we used them
    this.avatarService.deleteRawFile(rawS3Key)
    if (variantsUsed && replacesAvatarUrl) {
      this.avatarService.deleteAvatarFiles(replacesAvatarUrl)
    }
    if (!variantsUsed) {
      this.avatarService.deleteAvatarFiles(basePath)
    }

    logger.info({ avatarUploadId, memberId }, "Avatar processing completed")
  }
}
