declare const __brand: unique symbol
type Brand<T, B extends string> = T & { readonly [__brand]: B }

export type UserId = Brand<string, "UserId">
export type MemberId = Brand<string, "MemberId">
export type WorkspaceId = Brand<string, "WorkspaceId">
