import type { Pool } from "pg"
import type { AttachmentService } from "../../attachments"
import type { SearchService } from "../../search"
import type { StorageProvider } from "../../../lib/storage/s3-client"

export interface WorkspaceToolDeps {
  db: Pool
  workspaceId: string
  accessibleStreamIds: string[]
  invokingUserId: string
  searchService: SearchService
  storage: StorageProvider
  attachmentService: AttachmentService
}
