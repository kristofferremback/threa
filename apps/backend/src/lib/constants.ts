import { z } from "zod"

export const STREAM_TYPES = ["scratchpad", "channel", "dm", "thread"] as const
export const streamTypeSchema = z.enum(STREAM_TYPES)
export type StreamType = z.infer<typeof streamTypeSchema>

export const StreamTypes = {
  SCRATCHPAD: "scratchpad",
  CHANNEL: "channel",
  DM: "dm",
  THREAD: "thread",
} as const satisfies Record<string, StreamType>

export const VISIBILITY_OPTIONS = ["public", "private"] as const
export const visibilitySchema = z.enum(VISIBILITY_OPTIONS)
export type Visibility = z.infer<typeof visibilitySchema>

export const Visibilities = {
  PUBLIC: "public",
  PRIVATE: "private",
} as const satisfies Record<string, Visibility>

export const COMPANION_MODES = ["off", "on", "next_message_only"] as const
export const companionModeSchema = z.enum(COMPANION_MODES)
export type CompanionMode = z.infer<typeof companionModeSchema>

export const CompanionModes = {
  OFF: "off",
  ON: "on",
  NEXT_MESSAGE_ONLY: "next_message_only",
} as const satisfies Record<string, CompanionMode>

export const CONTENT_FORMATS = ["plaintext", "markdown"] as const
export const contentFormatSchema = z.enum(CONTENT_FORMATS)
export type ContentFormat = z.infer<typeof contentFormatSchema>

export const AUTHOR_TYPES = ["user", "persona"] as const
export const authorTypeSchema = z.enum(AUTHOR_TYPES)
export type AuthorType = z.infer<typeof authorTypeSchema>

export const AuthorTypes = {
  USER: "user",
  PERSONA: "persona",
} as const satisfies Record<string, AuthorType>
