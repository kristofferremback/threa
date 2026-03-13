// Search feature - Hybrid full-text and semantic message search
export { createSearchHandlers, serializeSearchResult } from "./handlers"
export { resolveUserAccessibleStreamIds } from "./access"
export { SearchService } from "./service"
export { SearchRepository } from "./repository"
export { SEMANTIC_DISTANCE_THRESHOLD } from "./config"

// Re-export types
export type { SearchResult, ResolvedFilters, GetAccessibleStreamsParams } from "./repository"
export type {
  SearchFilters,
  SearchParams,
  SearchPermissions,
  SearchServiceDependencies,
  ArchiveStatus,
} from "./service"
