import { ulid } from "ulid"

function generateId(prefix: string): string {
  return `${prefix}_${ulid()}`
}

export const userId = () => generateId("usr")
export const workspaceId = () => generateId("ws")
export const streamId = () => generateId("stream")
export const eventId = () => generateId("event")
export const messageId = () => generateId("msg")
export const attachmentId = () => generateId("attach")
export const personaId = () => generateId("persona")
export const notificationId = () => generateId("notif")
export const invitationId = () => generateId("inv")
export const sessionId = () => generateId("session")
export const stepId = () => generateId("step")
export const conversationId = () => generateId("conv")
export const memoId = () => generateId("memo")
export const pendingItemId = () => generateId("pending")
export const commandId = () => generateId("cmd")
export const emojiUsageId = () => generateId("emoji_usage")
export const aiUsageId = () => generateId("ai_usage")
export const aiBudgetId = () => generateId("ai_budget")
export const aiQuotaId = () => generateId("ai_quota")
export const aiAlertId = () => generateId("ai_alert")
export const researcherCacheId = () => generateId("rcache")
export const queueId = () => generateId("queue")
export const tokenId = () => generateId("token")
export const workerId = () => generateId("worker")
export const tickerId = () => generateId("ticker")
export const tickId = () => generateId("tick")
export const cronId = () => generateId("cron")
