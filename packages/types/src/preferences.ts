// =============================================================================
// User Preferences Types
// Workspace-scoped preferences that sync across devices
// =============================================================================

// Theme
export const THEME_OPTIONS = ["light", "dark", "system"] as const
export type Theme = (typeof THEME_OPTIONS)[number]

export const Themes = {
  LIGHT: "light",
  DARK: "dark",
  SYSTEM: "system",
} as const satisfies Record<string, Theme>

// Message display density
export const MESSAGE_DISPLAY_OPTIONS = ["compact", "comfortable"] as const
export type MessageDisplay = (typeof MESSAGE_DISPLAY_OPTIONS)[number]

export const MessageDisplays = {
  COMPACT: "compact",
  COMFORTABLE: "comfortable",
} as const satisfies Record<string, MessageDisplay>

// Date format (user chooses format independently of language)
export const DATE_FORMAT_OPTIONS = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"] as const
export type DateFormat = (typeof DATE_FORMAT_OPTIONS)[number]

export const DateFormats = {
  ISO: "YYYY-MM-DD",
  EU: "DD/MM/YYYY",
  US: "MM/DD/YYYY",
} as const satisfies Record<string, DateFormat>

// Time format
export const TIME_FORMAT_OPTIONS = ["24h", "12h"] as const
export type TimeFormat = (typeof TIME_FORMAT_OPTIONS)[number]

export const TimeFormats = {
  H24: "24h",
  H12: "12h",
} as const satisfies Record<string, TimeFormat>

// Notification level
export const NOTIFICATION_LEVEL_OPTIONS = ["all", "mentions", "none"] as const
export type NotificationLevel = (typeof NOTIFICATION_LEVEL_OPTIONS)[number]

export const NotificationLevels = {
  ALL: "all",
  MENTIONS: "mentions",
  NONE: "none",
} as const satisfies Record<string, NotificationLevel>

// Font size for accessibility
export const FONT_SIZE_OPTIONS = ["small", "medium", "large"] as const
export type FontSize = (typeof FONT_SIZE_OPTIONS)[number]

export const FontSizes = {
  SMALL: "small",
  MEDIUM: "medium",
  LARGE: "large",
} as const satisfies Record<string, FontSize>

// Font family for accessibility
export const FONT_FAMILY_OPTIONS = ["system", "monospace", "dyslexic"] as const
export type FontFamily = (typeof FONT_FAMILY_OPTIONS)[number]

export const FontFamilies = {
  SYSTEM: "system",
  MONOSPACE: "monospace",
  DYSLEXIC: "dyslexic",
} as const satisfies Record<string, FontFamily>

// Settings tab options (for URL-driven settings dialog)
export const SETTINGS_TAB_OPTIONS = ["appearance", "datetime", "notifications", "keyboard", "accessibility"] as const
export type SettingsTab = (typeof SETTINGS_TAB_OPTIONS)[number]

// Alias for convenience
export const SETTINGS_TABS = SETTINGS_TAB_OPTIONS

// =============================================================================
// Domain Types
// =============================================================================

/**
 * Accessibility preferences stored as JSONB
 */
export interface AccessibilityPreferences {
  reducedMotion: boolean
  highContrast: boolean
  fontSize: FontSize
  fontFamily: FontFamily
}

/**
 * Default accessibility preferences
 */
export const DEFAULT_ACCESSIBILITY: AccessibilityPreferences = {
  reducedMotion: false,
  highContrast: false,
  fontSize: "medium",
  fontFamily: "system",
}

/**
 * Keyboard shortcuts stored as JSONB
 * Maps action IDs to key bindings (e.g., "openQuickSwitcher": "mod+k")
 */
export interface KeyboardShortcuts {
  [actionId: string]: string
}

/**
 * Full user preferences domain type (wire format)
 */
export interface UserPreferences {
  workspaceId: string
  userId: string
  theme: Theme
  messageDisplay: MessageDisplay
  dateFormat: DateFormat
  timeFormat: TimeFormat
  timezone: string
  language: string
  notificationLevel: NotificationLevel
  sidebarCollapsed: boolean
  keyboardShortcuts: KeyboardShortcuts
  accessibility: AccessibilityPreferences
  createdAt: string
  updatedAt: string
}

/**
 * Default user preferences (matches database defaults)
 */
export const DEFAULT_USER_PREFERENCES: Omit<UserPreferences, "workspaceId" | "userId" | "createdAt" | "updatedAt"> = {
  theme: "system",
  messageDisplay: "comfortable",
  dateFormat: "YYYY-MM-DD",
  timeFormat: "24h",
  timezone: "UTC",
  language: "en",
  notificationLevel: "all",
  sidebarCollapsed: false,
  keyboardShortcuts: {},
  accessibility: DEFAULT_ACCESSIBILITY,
}

// =============================================================================
// API Types
// =============================================================================

/**
 * Input for updating user preferences (all fields optional for partial updates)
 */
export interface UpdateUserPreferencesInput {
  theme?: Theme
  messageDisplay?: MessageDisplay
  dateFormat?: DateFormat
  timeFormat?: TimeFormat
  timezone?: string
  language?: string
  notificationLevel?: NotificationLevel
  sidebarCollapsed?: boolean
  keyboardShortcuts?: KeyboardShortcuts
  accessibility?: Partial<AccessibilityPreferences>
}
