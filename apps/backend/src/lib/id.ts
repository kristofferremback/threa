import { ulid } from "ulid"

function generateId(prefix: string): string {
  return `${prefix}_${ulid()}`
}

export const userId = () => generateId("usr")
export const workspaceId = () => generateId("ws")
export const streamId = () => generateId("stream")
export const eventId = () => generateId("event")
export const messageId = () => generateId("msg")
export const notificationId = () => generateId("notif")
export const invitationId = () => generateId("inv")
