// Search feature - Hybrid full-text and semantic message search
export { createSearchHandlers } from "./handlers"
export { SearchService } from "./service"
export { SearchRepository } from "./repository"
export { SEMANTIC_DISTANCE_THRESHOLD } from "./config"

// Re-export types
export type { SearchResult, ResolvedFilters, GetAccessibleStreamsParams } from "./repository"
export type { SearchFilters, SearchParams, SearchServiceDependencies, ArchiveStatus } from "./service"
