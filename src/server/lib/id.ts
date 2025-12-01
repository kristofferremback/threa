import { randomUUID } from "crypto"

export function generateId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`
}

export function workspaceId(): string {
  return generateId("ws")
}

export function userId(): string {
  return generateId("usr")
}

export function channelId(): string {
  return generateId("chan")
}

export function conversationId(): string {
  return generateId("conv")
}

export function messageId(): string {
  return generateId("msg")
}

export function messageRevisionId(messageId: string, rev: number): string {
  return `${messageId}:${rev}`
}

export function messageReactionId(): string {
  return generateId("msgr")
}

export function memoId(): string {
  return generateId("memo")
}

export function retrievalLogId(): string {
  return generateId("retr")
}

export function expertiseSignalId(): string {
  return generateId("exp")
}

export function aiUsageId(): string {
  return generateId("aiu")
}

export function aiPersonaId(): string {
  return generateId("pers")
}

export function agentSessionId(): string {
  return generateId("sess")
}

export function sessionStepId(): string {
  return generateId("step")
}

export function tagId(): string {
  return generateId("tag")
}
