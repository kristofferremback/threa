// Asset explorer — read-side projection over attachments + extractions
// powering the stream-scoped (and future workspace-scoped) browse/search UI.
export { createAssetExplorerHandlers } from "./handlers"
export { AssetExplorerService } from "./service"
export type { AssetSearchParams, AssetSearchPermissions, AssetSearchOutput } from "./service"
export { AssetExplorerRepository } from "./repository"
export type { AssetSearchRepoResult, AssetSearchRepoParams } from "./repository"
export { resolveAssetSearchScope } from "./scope"
export { classifyAssetKind, mimePatternsForKinds } from "./mime-groups"
export { encodeCursor, decodeCursor } from "./cursor"
export type { AssetCursor } from "./cursor"
