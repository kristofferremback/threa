import { z } from "zod"

export const STREAM_TYPES = ["scratchpad", "channel", "dm", "thread"] as const
export const streamTypeSchema = z.enum(STREAM_TYPES)
export type StreamType = z.infer<typeof streamTypeSchema>

export const VISIBILITY_OPTIONS = ["public", "private"] as const
export const visibilitySchema = z.enum(VISIBILITY_OPTIONS)
export type Visibility = z.infer<typeof visibilitySchema>

export const COMPANION_MODES = ["off", "on", "next_message_only"] as const
export const companionModeSchema = z.enum(COMPANION_MODES)
export type CompanionMode = z.infer<typeof companionModeSchema>

export const CONTENT_FORMATS = ["plain", "markdown"] as const
export const contentFormatSchema = z.enum(CONTENT_FORMATS)
export type ContentFormat = z.infer<typeof contentFormatSchema>
