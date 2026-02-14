import type { Pool } from "pg"
import type { SearchService } from "../../search"
import type { StorageProvider } from "../../../lib/storage/s3-client"

export interface WorkspaceToolDeps {
  db: Pool
  workspaceId: string
  accessibleStreamIds: string[]
  invokingMemberId: string
  searchService: SearchService
  storage: StorageProvider
}
