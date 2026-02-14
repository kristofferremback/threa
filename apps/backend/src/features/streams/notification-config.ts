import type { StreamType, NotificationLevel } from "@threa/types"

interface NotificationConfig {
  defaultLevel: NotificationLevel
  allowedLevels: readonly NotificationLevel[]
}

export const NOTIFICATION_CONFIG: Record<StreamType, NotificationConfig> = {
  scratchpad: { defaultLevel: "everything", allowedLevels: ["everything", "muted"] },
  dm: { defaultLevel: "everything", allowedLevels: ["everything", "muted"] },
  system: { defaultLevel: "everything", allowedLevels: ["everything", "muted"] },
  channel: { defaultLevel: "mentions", allowedLevels: ["everything", "activity", "mentions", "muted"] },
  thread: { defaultLevel: "activity", allowedLevels: ["everything", "activity", "mentions", "muted"] },
}

export function isAllowedLevel(streamType: StreamType, level: NotificationLevel): boolean {
  return NOTIFICATION_CONFIG[streamType].allowedLevels.includes(level)
}

export function getDefaultLevel(streamType: StreamType): NotificationLevel {
  return NOTIFICATION_CONFIG[streamType].defaultLevel
}

/**
 * Resolve effective notification level from an explicit level and stream type.
 * Explicit level wins; NULL falls back to stream-type default.
 * Does NOT consider ancestor inheritance — use the resolver for that.
 */
export function getEffectiveLevel(
  explicitLevel: NotificationLevel | null | undefined,
  streamType: StreamType
): NotificationLevel {
  return explicitLevel ?? getDefaultLevel(streamType)
}
