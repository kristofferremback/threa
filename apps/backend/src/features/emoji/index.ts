// Emoji handlers (HTTP routes)
export { createEmojiHandlers } from "./handlers"

// Emoji usage repository
export { EmojiUsageRepository } from "./usage-repository"
export type { EmojiUsage, InsertEmojiUsageParams } from "./usage-repository"

// Emoji usage outbox handler
export { EmojiUsageHandler } from "./usage-outbox-handler"
export type { EmojiUsageHandlerConfig } from "./usage-outbox-handler"

// Emoji utilities
export { toShortcode, toEmoji, isValidShortcode, getShortcodeNames, normalizeMessage, getEmojiList } from "./emoji"
export type { EmojiEntry } from "./emoji"
