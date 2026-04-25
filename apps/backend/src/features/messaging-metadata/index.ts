/**
 * Shared Zod schema + constants for message metadata (external references).
 *
 * Metadata is a flat string->string map queried with AND-containment semantics.
 * Keys under the `threa.*` namespace are reserved for system-generated metadata
 * so user callers can't spoof internal markers.
 */
import { z } from "zod"

export const MESSAGE_METADATA_MAX_KEYS = 20
export const MESSAGE_METADATA_MAX_KEY_LENGTH = 64
export const MESSAGE_METADATA_MAX_VALUE_LENGTH = 256
export const MESSAGE_METADATA_MAX_SERIALIZED_BYTES = 4096
export const MESSAGE_METADATA_RESERVED_PREFIX = "threa."

/** Allowed characters for metadata keys: letters, digits, `_.-:` */
const METADATA_KEY_PATTERN = /^[a-zA-Z0-9_.\-:]+$/

/**
 * Validator for caller-supplied metadata on message creation.
 * - Rejects reserved `threa.*` keys.
 * - Caps map size (keys), individual key/value length, and total serialized size.
 */
export const messageMetadataSchema = z
  .record(
    z
      .string()
      .min(1, "metadata keys must be non-empty")
      .max(
        MESSAGE_METADATA_MAX_KEY_LENGTH,
        `metadata keys must be at most ${MESSAGE_METADATA_MAX_KEY_LENGTH} characters`
      )
      .regex(METADATA_KEY_PATTERN, "metadata keys may only contain letters, digits, and _.-:"),
    z
      .string()
      .max(
        MESSAGE_METADATA_MAX_VALUE_LENGTH,
        `metadata values must be at most ${MESSAGE_METADATA_MAX_VALUE_LENGTH} characters`
      )
  )
  .refine((m) => !Object.keys(m).some((k) => k.startsWith(MESSAGE_METADATA_RESERVED_PREFIX)), {
    message: `metadata keys starting with "${MESSAGE_METADATA_RESERVED_PREFIX}" are reserved`,
  })
  .refine((m) => Object.keys(m).length <= MESSAGE_METADATA_MAX_KEYS, {
    message: `metadata may contain at most ${MESSAGE_METADATA_MAX_KEYS} keys`,
  })
  .refine((m) => JSON.stringify(m).length <= MESSAGE_METADATA_MAX_SERIALIZED_BYTES, {
    message: `metadata exceeds ${MESSAGE_METADATA_MAX_SERIALIZED_BYTES} serialized bytes`,
  })

/**
 * Validator for a non-empty metadata filter used by the find-by-metadata endpoint.
 * Same shape as {@link messageMetadataSchema} but requires at least one key (an
 * empty filter would match every message with metadata, which is never useful).
 *
 * Reserved keys are allowed here because callers may legitimately query system-
 * generated metadata (e.g. "show me messages `threa.source` set").
 */
export const messageMetadataFilterSchema = z
  .record(
    z
      .string()
      .min(1, "metadata keys must be non-empty")
      .max(MESSAGE_METADATA_MAX_KEY_LENGTH)
      .regex(METADATA_KEY_PATTERN, "metadata keys may only contain letters, digits, and _.-:"),
    z.string().max(MESSAGE_METADATA_MAX_VALUE_LENGTH)
  )
  .refine((m) => Object.keys(m).length > 0, { message: "metadata filter must have at least one key" })
  .refine((m) => Object.keys(m).length <= MESSAGE_METADATA_MAX_KEYS, {
    message: `metadata filter may contain at most ${MESSAGE_METADATA_MAX_KEYS} keys`,
  })
