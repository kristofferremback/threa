import { z } from "zod"
import {
  STREAM_TYPES,
  VISIBILITY_OPTIONS,
  COMPANION_MODES,
  CONTENT_FORMATS,
  AUTHOR_TYPES,
  NOTIFICATION_LEVELS,
} from "@threa/types"

export const streamTypeSchema = z.enum(STREAM_TYPES)
export const visibilitySchema = z.enum(VISIBILITY_OPTIONS)
export const companionModeSchema = z.enum(COMPANION_MODES)
export const contentFormatSchema = z.enum(CONTENT_FORMATS)
export const authorTypeSchema = z.enum(AUTHOR_TYPES)
export const notificationLevelSchema = z.enum(NOTIFICATION_LEVELS)
