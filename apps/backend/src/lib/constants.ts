import { z } from "zod"

// Re-export constants and types from shared package
export {
  STREAM_TYPES,
  type StreamType,
  StreamTypes,
  VISIBILITY_OPTIONS,
  type Visibility,
  Visibilities,
  COMPANION_MODES,
  type CompanionMode,
  CompanionModes,
  CONTENT_FORMATS,
  type ContentFormat,
  AUTHOR_TYPES,
  type AuthorType,
  AuthorTypes,
} from "@threa/types"

// Zod schemas derived from shared constants (validation is backend-only)
import { STREAM_TYPES, VISIBILITY_OPTIONS, COMPANION_MODES, CONTENT_FORMATS, AUTHOR_TYPES } from "@threa/types"

export const streamTypeSchema = z.enum(STREAM_TYPES)
export const visibilitySchema = z.enum(VISIBILITY_OPTIONS)
export const companionModeSchema = z.enum(COMPANION_MODES)
export const contentFormatSchema = z.enum(CONTENT_FORMATS)
export const authorTypeSchema = z.enum(AUTHOR_TYPES)
