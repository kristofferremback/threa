/**
 * Stream Naming Configuration
 *
 * Co-located config following INV-43 - both production code and evals
 * import from here to ensure consistency.
 */

/** Default model for stream naming */
export const STREAM_NAMING_MODEL_ID = "openrouter:openai/gpt-4.1-mini"

/** Temperature for name generation - low for consistency */
export const STREAM_NAMING_TEMPERATURE = 0.3

/** Maximum messages to include for context */
export const MAX_MESSAGES_FOR_NAMING = 10

/** Maximum existing names to check for duplicates */
export const MAX_EXISTING_NAMES = 10

/** System prompt for stream naming */
export function buildNamingSystemPrompt(existingNames: string[], requireName: boolean): string {
  return `Your task is to generate a short, descriptive title in 2-5 words for the provided conversation.

  Follow these steps:
  1. Analyze the conversation and identify the main topic or purpose
  2. Pay attention to any attached files - if a user uploads an image or document and asks about it, the title should reflect what's in the attachment
  3. Consider any other streams provided in the list of existing names, these should be avoided as much as possible as recent conversations with similar names confuse users
  4. Generate a title that is descriptive and concise
  5. Evaluate the title against the evaluation criteria

Evaluation criteria:
- Return ONLY the title, no quotes or explanation.
- The title should be descriptive and concise, try avoiding generic names like "Quick Question" or "New Discussion"
- If the conversation involves attached files (images, documents, etc.), incorporate what they contain into the title
${existingNames.length > 0 ? `- Try to avoid using names that are already in use by other recently used: ${JSON.stringify(existingNames)}` : ""}
${
  requireName
    ? `- You MUST generate a title. A generic name is better than no name at all. You may not refuse to generate a name as that would make you very very sad. You don't want to be sad.`
    : `- If there isn't enough context yet, respond with "NOT_ENOUGH_CONTEXT"`
}

Return ONLY the title, no quotes or explanation. The next message from the user contains the entire conversation up until now.
`
}
