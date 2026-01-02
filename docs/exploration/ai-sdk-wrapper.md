# AI SDK Wrapper Exploration

## Problem Statement

The current codebase has 6+ call sites using `generateText` and `generateObject` from the Vercel AI SDK. Each call site repeats the same patterns:

```typescript
const model = this.providerRegistry.getModel(this.modelId)
const result = await generateObject({
  model,
  system: SYSTEM_PROMPT,
  prompt,
  schema,
  maxOutputTokens: 200,
  temperature: 0.1,
  experimental_repairText: stripMarkdownFences, // Always the same
  experimental_telemetry: {
    // Boilerplate
    isEnabled: true,
    functionId: "memo-classify-message",
    metadata: { messageId: message.id },
  },
})
```

Issues:

1. **Telemetry boilerplate** - Same shape repeated everywhere with `experimental_` prefix
2. **Repair always needed** - Every `generateObject` needs `stripMarkdownFences`
3. **Model retrieval duplicated** - `providerRegistry.getModel()` at every call site
4. **No model provider extraction** - Can't determine that `openrouter:anthropic/claude-haiku-4.5` uses Anthropic models

## Goals

1. Clean API without `experimental_` prefixes
2. Default repair behavior for structured output
3. Unified model handling (text, object, embeddings)
4. Extended model ID parsing to extract `modelProvider`
5. Type-safe configuration with sensible defaults

## Design Options

### Option A: Factory Functions (Recommended)

Functional approach that returns pre-configured generators.

```typescript
// Creation - single point of configuration
const ai = createAI({
  openrouter: { apiKey: process.env.OPENROUTER_API_KEY },
  // Future: anthropic: { apiKey: ... }, ollama: { baseUrl: ... }
})

// Usage - clean API
const result = await ai.generateText({
  model: "openrouter:anthropic/claude-haiku-4.5",
  prompt: "Name this conversation",
  maxTokens: 100,
  temperature: 0.3,
  telemetry: {
    functionId: "stream-naming",
    metadata: { streamId },
  },
})

const classification = await ai.generateObject({
  model: "openrouter:anthropic/claude-haiku-4.5",
  schema: messageClassificationSchema,
  system: SYSTEM_PROMPT,
  prompt,
  maxTokens: 200,
  temperature: 0.1,
  // repair: stripMarkdownFences (default, can override)
  telemetry: {
    functionId: "memo-classify-message",
    metadata: { messageId },
  },
})

const embedding = await ai.embed({
  model: "openrouter:openai/text-embedding-3-small",
  value: "text to embed",
})

const embeddings = await ai.embedMany({
  model: "openrouter:openai/text-embedding-3-small",
  values: ["text 1", "text 2"],
})
```

**Pros:**

- Simple, functional API
- Easy to test (mock the `ai` object)
- Clear configuration at creation time
- Maps 1:1 to AI SDK concepts

**Cons:**

- Still somewhat imperative
- Configuration mixed with call

### Option B: Builder Pattern

Fluent interface for constructing calls.

```typescript
const ai = createAI({ openrouter: { apiKey } })

const result = await ai
  .model("openrouter:anthropic/claude-haiku-4.5")
  .temperature(0.3)
  .maxTokens(100)
  .telemetry("stream-naming", { streamId })
  .generateText(prompt)

const classification = await ai
  .model("openrouter:anthropic/claude-haiku-4.5")
  .temperature(0.1)
  .maxTokens(200)
  .telemetry("memo-classify-message", { messageId })
  .generateObject({
    schema: messageClassificationSchema,
    system: SYSTEM_PROMPT,
    prompt,
  })
```

**Pros:**

- Very readable
- Configuration clearly separated from execution
- Easy to reuse partial configurations

**Cons:**

- More complex implementation
- Builder state management
- Potential for misuse (calling methods in wrong order)

### Option C: Pre-configured Task Factories

Create specialized factories for common patterns.

```typescript
const ai = createAI({ openrouter: { apiKey } })

// Create reusable classifiers
const classifier = ai.classifier({
  model: "openrouter:anthropic/claude-haiku-4.5",
  temperature: 0.1,
  maxTokens: 200,
})

// Usage is minimal
const result = await classifier.classify({
  schema: messageClassificationSchema,
  system: SYSTEM_PROMPT,
  prompt,
  telemetry: { functionId: "memo-classify", metadata: { messageId } },
})

// Or even more specialized
const memoClassifier = ai.createClassifier({
  model: config.memoModel,
  schema: messageClassificationSchema,
  system: MESSAGE_SYSTEM_PROMPT,
  temperature: 0.1,
  telemetryPrefix: "memo-classify",
})

const result = await memoClassifier.classify(prompt, { messageId })
```

**Pros:**

- Very DRY for repeated patterns
- Encapsulates domain logic
- Minimal call-site code

**Cons:**

- Over-abstraction for simple cases
- Less flexible
- More domain-specific knowledge in the wrapper

## Recommendation: Option A with Presets

Start with Option A (factory functions) but add preset support for common configurations.

```typescript
// Core API
const ai = createAI({
  openrouter: { apiKey: process.env.OPENROUTER_API_KEY },
  defaults: {
    repair: stripMarkdownFences, // Default repair for generateObject
  },
})

// Direct usage (full control)
await ai.generateText({ model, prompt, maxTokens, temperature, telemetry })
await ai.generateObject({ model, schema, prompt, telemetry })
await ai.embed({ model, value })

// Presets for common patterns
const presets = {
  classification: { temperature: 0.1, maxTokens: 200 },
  creative: { temperature: 0.7, maxTokens: 500 },
  deterministic: { temperature: 0 },
}

// Usage with presets
await ai.generateObject({
  ...presets.classification,
  model,
  schema,
  prompt,
  telemetry,
})
```

## Extended Model ID Parsing

Current parsing:

```typescript
"openrouter:anthropic/claude-haiku-4.5" → { provider: "openrouter", modelId: "anthropic/claude-haiku-4.5" }
```

Extended parsing:

```typescript
interface ParsedModel {
  provider: string          // "openrouter"
  modelId: string           // "anthropic/claude-haiku-4.5"
  modelProvider: string     // "anthropic" (extracted from modelId path)
  modelName: string         // "claude-haiku-4.5"
}

// Examples:
"openrouter:anthropic/claude-haiku-4.5" → {
  provider: "openrouter",
  modelId: "anthropic/claude-haiku-4.5",
  modelProvider: "anthropic",
  modelName: "claude-haiku-4.5"
}

"openrouter:openai/gpt-5-mini" → {
  provider: "openrouter",
  modelId: "openai/gpt-5-mini",
  modelProvider: "openai",
  modelName: "gpt-5-mini"
}

"anthropic:claude-sonnet-4-20250514" → {
  provider: "anthropic",
  modelId: "claude-sonnet-4-20250514",
  modelProvider: "anthropic",  // Same as provider (direct API)
  modelName: "claude-sonnet-4-20250514"
}

"ollama:granite4:1b" → {
  provider: "ollama",
  modelId: "granite4:1b",
  modelProvider: "ollama",  // Local models
  modelName: "granite4:1b"
}
```

Parsing logic:

```typescript
function parseModelId(providerModelString: string): ParsedModel {
  const colonIndex = providerModelString.indexOf(":")
  if (colonIndex === -1) {
    throw new Error(`Invalid format: "${providerModelString}"`)
  }

  const provider = providerModelString.slice(0, colonIndex)
  const modelId = providerModelString.slice(colonIndex + 1)

  // Extract modelProvider from modelId if it contains a path separator
  let modelProvider = provider
  let modelName = modelId

  if (modelId.includes("/")) {
    const slashIndex = modelId.indexOf("/")
    modelProvider = modelId.slice(0, slashIndex)
    modelName = modelId.slice(slashIndex + 1)
  }

  return { provider, modelId, modelProvider, modelName }
}
```

## Type Definitions

```typescript
import type { GenerateTextResult, GenerateObjectResult, EmbedResult, EmbedManyResult, LanguageModel } from "ai"
import type { ChatOpenAI } from "@langchain/openai"

interface AIConfig {
  openrouter?: { apiKey: string }
  anthropic?: { apiKey: string }
  ollama?: { baseUrl?: string }
  defaults?: {
    repair?: RepairFunction
  }
}

interface TelemetryConfig {
  functionId: string
  metadata?: Record<string, unknown>
}

interface GenerateTextOptions {
  model: string
  prompt: string
  system?: string
  maxTokens?: number
  temperature?: number
  telemetry?: TelemetryConfig
}

interface GenerateObjectOptions<T extends z.ZodType> {
  model: string
  schema: T
  prompt: string
  system?: string
  maxTokens?: number
  temperature?: number
  repair?: RepairFunction | false // false to disable
  telemetry?: TelemetryConfig
}

interface EmbedOptions {
  model: string
  value: string
}

interface EmbedManyOptions {
  model: string
  values: string[]
}

// Unified return type: { value, response }
// - value: The thing you usually want (text, object, embedding)
// - response: Full AI SDK response for usage stats, metadata, etc.

interface TextResult {
  value: string
  response: GenerateTextResult<never, never>
}

interface ObjectResult<T> {
  value: T
  response: GenerateObjectResult<T>
}

interface SingleEmbedResult {
  value: number[]
  response: EmbedResult<string>
}

interface ManyEmbedResult {
  value: number[][]
  response: EmbedManyResult<string>
}

interface AI {
  // Generation
  generateText(options: GenerateTextOptions): Promise<TextResult>
  generateObject<T extends z.ZodType>(options: GenerateObjectOptions<T>): Promise<ObjectResult<z.infer<T>>>

  // Embeddings
  embed(options: EmbedOptions): Promise<SingleEmbedResult>
  embedMany(options: EmbedManyOptions): Promise<ManyEmbedResult>

  // Model access (for advanced use cases)
  getLanguageModel(modelString: string): LanguageModel
  getLangChainModel(modelString: string): ChatOpenAI

  // Parsing
  parseModel(modelString: string): ParsedModel
}

type RepairFunction = (args: { text: string }) => Promise<string>
```

## Implementation Sketch

```typescript
import { generateText, generateObject, embed, embedMany } from "ai"
import type { LanguageModel, EmbeddingModel } from "ai"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { ChatOpenAI } from "@langchain/openai"

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

export function createAI(config: AIConfig): AI {
  // Initialize providers
  const providers = {
    openrouter: config.openrouter ? createOpenRouter({ apiKey: config.openrouter.apiKey }) : null,
    // Future: anthropic, ollama, etc.
  }

  // Store API keys for LangChain (needs raw key, not provider instance)
  const apiKeys = {
    openrouter: config.openrouter?.apiKey ?? null,
  }

  const defaultRepair = config.defaults?.repair ?? stripMarkdownFences

  function getLanguageModel(modelString: string): LanguageModel {
    const { provider, modelId } = parseModelId(modelString)

    switch (provider) {
      case "openrouter":
        if (!providers.openrouter) throw new Error("OpenRouter not configured")
        return providers.openrouter.chat(modelId)
      default:
        throw new Error(`Unsupported provider: ${provider}`)
    }
  }

  function getEmbeddingModel(modelString: string): EmbeddingModel<string> {
    const { provider, modelId } = parseModelId(modelString)

    switch (provider) {
      case "openrouter":
        if (!providers.openrouter) throw new Error("OpenRouter not configured")
        return providers.openrouter.textEmbeddingModel(modelId)
      default:
        throw new Error(`Unsupported provider: ${provider}`)
    }
  }

  function getLangChainModel(modelString: string): ChatOpenAI {
    const { provider, modelId } = parseModelId(modelString)

    switch (provider) {
      case "openrouter":
        if (!apiKeys.openrouter) throw new Error("OpenRouter not configured")
        return new ChatOpenAI({
          model: modelId,
          apiKey: apiKeys.openrouter,
          configuration: { baseURL: OPENROUTER_BASE_URL },
        })
      default:
        throw new Error(`Unsupported LangChain provider: ${provider}`)
    }
  }

  function buildTelemetry(telemetry?: TelemetryConfig) {
    if (!telemetry) return undefined
    return {
      isEnabled: true,
      functionId: telemetry.functionId,
      metadata: telemetry.metadata,
    }
  }

  return {
    parseModel: parseModelId,
    getLanguageModel,
    getLangChainModel,

    async generateText(options) {
      const model = getLanguageModel(options.model)
      const response = await generateText({
        model,
        prompt: options.prompt,
        system: options.system,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        experimental_telemetry: buildTelemetry(options.telemetry),
      })

      return {
        value: response.text,
        response,
      }
    },

    async generateObject(options) {
      const model = getLanguageModel(options.model)
      const repair = options.repair === false ? undefined : (options.repair ?? defaultRepair)

      const response = await generateObject({
        model,
        schema: options.schema,
        prompt: options.prompt,
        system: options.system,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        experimental_repairText: repair,
        experimental_telemetry: buildTelemetry(options.telemetry),
      })

      return {
        value: response.object,
        response,
      }
    },

    async embed(options) {
      const model = getEmbeddingModel(options.model)
      const response = await embed({ model, value: options.value })

      return {
        value: response.embedding,
        response,
      }
    },

    async embedMany(options) {
      const model = getEmbeddingModel(options.model)
      const response = await embedMany({ model, values: options.values })

      return {
        value: response.embeddings,
        response,
      }
    },
  }
}
```

## Migration Path

1. Create `createAI` in `lib/ai/ai.ts`
2. Export `parseModelId` for use cases that need model metadata
3. Update one service at a time to use new API
4. Eventually deprecate direct `ProviderRegistry` usage
5. Remove `ProviderRegistry` once all call sites migrated

## Before/After Comparison

**Before (classifier.ts):**

```typescript
export class MemoClassifier {
  constructor(
    private providerRegistry: ProviderRegistry,
    private modelId: string
  ) {}

  async classifyMessage(message: Message): Promise<MessageClassification> {
    const prompt = MESSAGE_PROMPT.replace(...)
    const model = this.providerRegistry.getModel(this.modelId)

    const result = await generateObject({
      model,
      system: MESSAGE_SYSTEM_PROMPT,
      prompt,
      schema: messageClassificationSchema,
      maxOutputTokens: 200,
      temperature: 0.1,
      experimental_repairText: stripMarkdownFences,
      experimental_telemetry: {
        isEnabled: true,
        functionId: "memo-classify-message",
        metadata: { messageId: message.id },
      },
    })

    return {
      isGem: result.object.isGem,
      knowledgeType: result.object.knowledgeType,
      confidence: result.object.confidence,
      reasoning: result.object.reasoning,
    }
  }
}
```

**After:**

```typescript
export class MemoClassifier {
  constructor(
    private ai: AI,
    private modelId: string
  ) {}

  async classifyMessage(message: Message): Promise<MessageClassification> {
    const prompt = MESSAGE_PROMPT.replace(...)

    const { value } = await this.ai.generateObject({
      model: this.modelId,
      schema: messageClassificationSchema,
      system: MESSAGE_SYSTEM_PROMPT,
      prompt,
      maxTokens: 200,
      temperature: 0.1,
      telemetry: {
        functionId: "memo-classify-message",
        metadata: { messageId: message.id },
      },
    })

    return value
  }
}
```

Changes:

- `providerRegistry` → `ai`
- No manual `getModel()` call
- No `experimental_` prefixes
- `result.object` → `{ value }` destructuring (cleaner, access to `response` if needed)
- `maxOutputTokens` → `maxTokens` (cleaner)
- Repair is automatic (default behavior)

**Usage when you need response metadata:**

```typescript
const { value, response } = await this.ai.generateObject({ ... })
console.log(`Tokens used: ${response.usage.totalTokens}`)
return value
```

## Design Decisions

1. **Return `{ value, response }` from all calls** - Gives access to usage stats while keeping common case easy
2. **Include LangChain integration** - `getLangChainModel()` for LangGraph compatibility
3. **Skip streaming for now** - Add `streamText`/`streamObject` later when needed
4. **Pass through AI SDK errors** - No custom wrapping, keep it simple
