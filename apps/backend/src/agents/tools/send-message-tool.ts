import { DynamicStructuredTool } from "@langchain/core/tools"
import { z } from "zod"

const SendMessageSchema = z.object({
  content: z.string().describe("The message content to send"),
})

export type SendMessageInput = z.infer<typeof SendMessageSchema>

export interface SendMessageResult {
  messageId: string
  content: string
}

export interface CreateSendMessageToolParams {
  onSendMessage: (input: SendMessageInput) => Promise<SendMessageResult>
  maxMessages: number
  getMessagesSent: () => number
}

/**
 * Creates a send_message tool for the agent to explicitly send messages.
 *
 * The tool tracks message count and enforces a maximum limit per session.
 * When the limit is reached, it returns an error instead of sending.
 */
export function createSendMessageTool(params: CreateSendMessageToolParams) {
  const { onSendMessage, maxMessages, getMessagesSent } = params

  return new DynamicStructuredTool({
    name: "send_message",
    description: "Send a message to the conversation. You can call this multiple times to send multiple messages.",
    schema: SendMessageSchema,
    func: async (input: SendMessageInput) => {
      const messagesSent = getMessagesSent()

      if (messagesSent >= maxMessages) {
        return JSON.stringify({
          error: `Maximum message limit (${maxMessages}) reached for this session. Cannot send more messages.`,
          messagesSent,
          maxMessages,
        })
      }

      const result = await onSendMessage(input)

      return JSON.stringify({
        success: true,
        messageId: result.messageId,
        content: result.content,
        messagesSent: messagesSent + 1,
        messagesRemaining: maxMessages - messagesSent - 1,
      })
    },
  })
}
