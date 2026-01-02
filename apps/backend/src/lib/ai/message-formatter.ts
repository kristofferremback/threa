import type { PoolClient } from "pg"
import type { Message } from "../../repositories/message-repository"
import { UserRepository } from "../../repositories/user-repository"
import { PersonaRepository } from "../../repositories/persona-repository"

/**
 * Formats messages for use in AI prompts with author names resolved from the database.
 *
 * Methods accept PoolClient to participate in the caller's transaction rather than
 * managing their own connections.
 */
export class MessageFormatter {
  /**
   * Format messages with author names resolved from the database.
   * Batch-fetches all unique author IDs to minimize queries (2 max: users + personas).
   *
   * @example
   * const formatted = await messageFormatter.formatMessages(client, messages)
   * // <messages>
   * // <message authorType="user" authorId="user_123" authorName="Alice" createdAt="2021-01-01T00:00:00Z">Hello!</message>
   * // <message authorType="persona" authorId="persona_456" authorName="Ariadne" createdAt="2021-01-01T00:00:01Z">Hi there!</message>
   * // </messages>
   */
  async formatMessages(client: PoolClient, messages: Message[]): Promise<string> {
    if (messages.length === 0) return "<messages></messages>"

    const nameById = await this.resolveAuthorNames(client, messages)

    const formatted = messages.map((m) => this.formatSingleMessage(m, nameById))

    return `<messages>\n${formatted.join("\n")}\n</messages>`
  }

  /**
   * Batch-resolve author names for a set of messages.
   * Returns a map from authorId to name.
   */
  private async resolveAuthorNames(client: PoolClient, messages: Message[]): Promise<Map<string, string>> {
    const userIds: string[] = []
    const personaIds: string[] = []

    for (const m of messages) {
      if (m.authorType === "user") {
        userIds.push(m.authorId)
      } else {
        personaIds.push(m.authorId)
      }
    }

    const [users, personas] = await Promise.all([
      UserRepository.findByIds(client, [...new Set(userIds)]),
      PersonaRepository.findByIds(client, [...new Set(personaIds)]),
    ])

    const nameById = new Map<string, string>()
    for (const u of users) nameById.set(u.id, u.name)
    for (const p of personas) nameById.set(p.id, p.name)

    return nameById
  }

  private formatSingleMessage(m: Message, nameById: Map<string, string>): string {
    const authorName = nameById.get(m.authorId) ?? "Unknown"
    return `<message authorType="${m.authorType}" authorId="${m.authorId}" authorName="${authorName}" createdAt="${m.createdAt}">${m.content}</message>`
  }

  /**
   * Format messages in a simple inline format for prompts.
   * Batch-fetches all unique author IDs to minimize queries.
   *
   * @param options.includeIds - Include message IDs in the output (for memorizer)
   *
   * @example
   * // Without IDs (classifier)
   * const formatted = await messageFormatter.formatMessagesInline(client, messages)
   * // [user] Alice: Hello!
   * // [persona] Ariadne: Hi there!
   *
   * @example
   * // With IDs (memorizer)
   * const formatted = await messageFormatter.formatMessagesInline(client, messages, { includeIds: true })
   * // [ID:msg_123] [user] Alice: Hello!
   * // [ID:msg_456] [persona] Ariadne: Hi there!
   */
  async formatMessagesInline(
    client: PoolClient,
    messages: Message[],
    options?: { includeIds?: boolean }
  ): Promise<string> {
    if (messages.length === 0) return ""

    const nameById = await this.resolveAuthorNames(client, messages)

    const formatted = messages.map((m) => {
      const authorName = nameById.get(m.authorId) ?? "Unknown"
      const idPrefix = options?.includeIds ? `[ID:${m.id}] ` : ""
      return `${idPrefix}[${m.authorType}] ${authorName}: ${m.content}`
    })

    return formatted.join("\n\n")
  }
}
