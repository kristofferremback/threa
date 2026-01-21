# AI Model Reference

**Last updated:** 2026-01-20

This document provides a comprehensive reference for AI models including capabilities, pricing, and usage guidelines. Always verify against this file when working with AI integration.

## Model Format

All models use `provider:modelPath` format:

- `openrouter:anthropic/claude-haiku-4.5`
- `openrouter:anthropic/claude-sonnet-4.5`

**Note:** OpenRouter uses version numbers (e.g., `claude-sonnet-4.5`), not date-suffixed versions (e.g., `claude-sonnet-4-20250514`). Don't use date suffixes - they don't exist on OpenRouter.

## Inference Models

### openrouter:anthropic/claude-haiku-4.5

**Name:** Claude Haiku 4.5

**Description:** Fast, cost-effective model from Anthropic's Claude 4.5 generation. Good balance of speed, cost, and accuracy for structured tasks.

**Typical cost:** ~$0.25 per 1M input tokens, ~$1.25 per 1M output tokens

**When to use:**

- Classification and extraction (structured output)
- Simple reasoning tasks
- General chat and conversations
- High-volume batch operations where quality bar is met
- Stream naming, memo classification

**Use instead of:** `claude-3-haiku`, `claude-3.5-haiku`, or any Claude 3.x series models

---

### openrouter:anthropic/claude-sonnet-4.5

**Name:** Claude Sonnet 4.5

**Description:** High-quality reasoning model from Anthropic's Claude 4 generation. Best for complex tasks requiring nuanced understanding and generation.

**Typical cost:** ~$3.00 per 1M input tokens, ~$15.00 per 1M output tokens

**When to use:**

- Complex reasoning and generation
- Multi-turn agent conversations (LangGraph/LangChain)
- Nuanced text generation requiring high quality
- Tasks where quality justifies higher cost
- Companion agent responses, simulation agents

**Use instead of:** `claude-3-sonnet`, `claude-3.5-sonnet`, `claude-3-opus`, or any Claude 3.x series models

---

## Embedding Models

### openrouter:openai/text-embedding-3-small

**Name:** Text Embedding 3 Small

**Description:** Standard embedding model from OpenAI for semantic search and similarity tasks.

**Typical cost:** ~$0.02 per 1M tokens

**When to use:**

- Message and memo embeddings for semantic search
- Similarity comparisons
- Vector database indexing
- All embedding needs unless specific requirements dictate otherwise

**Use instead of:** `text-embedding-ada-002`, older embedding models

---

## Deprecated Models (Do Not Use)

**Claude 3 Series:**

- ❌ `openrouter:anthropic/claude-3-haiku` → Use `openrouter:anthropic/claude-haiku-4.5`
- ❌ `openrouter:anthropic/claude-3-sonnet` → Use `openrouter:anthropic/claude-sonnet-4.5`
- ❌ `openrouter:anthropic/claude-3.5-sonnet` → Use `openrouter:anthropic/claude-sonnet-4.5`
- ❌ `openrouter:anthropic/claude-3-opus` → Use `openrouter:anthropic/claude-opus-4.5`

**OpenAI Legacy:**

- ❌ `openrouter:openai/gpt-3.5-turbo` → Use Claude Haiku 4.5 for cost-effective tasks
- ❌ `openrouter:openai/gpt-4o` → Use Claude models instead
- ❌ `openrouter:openai/gpt-4o-mini` → Use Claude Haiku 4.5 instead

**Why deprecated:** Claude 3 series, GPT-3.5, and GPT-4o family are outdated or not preferred. Claude 4.5 generation offers better reasoning, structured output, and reliability for our use cases.
