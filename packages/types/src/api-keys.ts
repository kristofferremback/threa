export const API_KEY_SCOPES = {
  MESSAGES_SEARCH: "messages:search",
} as const

export type ApiKeyScope = (typeof API_KEY_SCOPES)[keyof typeof API_KEY_SCOPES]
