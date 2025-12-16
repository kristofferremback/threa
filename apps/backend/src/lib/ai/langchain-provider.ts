import { ChatOpenAI } from "@langchain/openai"

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

/**
 * Creates a ChatOpenAI instance configured for OpenRouter.
 *
 * OpenRouter is API-compatible with OpenAI, so we use ChatOpenAI with a custom baseURL.
 * This allows us to use any model available on OpenRouter (Claude, GPT, Llama, etc.)
 * through the LangChain interface.
 */
export function createChatModel(modelId: string, apiKey: string): ChatOpenAI {
  if (!apiKey) {
    throw new Error("OpenRouter API key is required")
  }

  return new ChatOpenAI({
    modelName: modelId,
    openAIApiKey: apiKey,
    configuration: {
      baseURL: OPENROUTER_BASE_URL,
    },
  })
}

/**
 * Parses a provider:model string and returns just the model ID.
 * For LangChain, we only need the model ID since we're always using OpenRouter.
 *
 * Example: "openrouter:anthropic/claude-3-haiku" -> "anthropic/claude-3-haiku"
 */
export function parseModelId(providerModelString: string): string {
  const colonIndex = providerModelString.indexOf(":")
  if (colonIndex === -1) {
    return providerModelString
  }

  const provider = providerModelString.slice(0, colonIndex)
  const modelId = providerModelString.slice(colonIndex + 1)

  if (provider !== "openrouter") {
    throw new Error(
      `Unsupported provider "${provider}" for LangChain. Only "openrouter" is supported.`,
    )
  }

  return modelId
}
