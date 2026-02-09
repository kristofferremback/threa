# Backend AI Integration

This project uses a single AI wrapper in `apps/backend/src/lib/ai/ai.ts`.
Use this document as the backend-specific reference for configuration, telemetry, cost tracking, repair behavior, and LangChain integration.

## Core Rule

- Always call AI through `createAI()` (INV-28). Do not import provider SDKs directly in feature code.
- Model IDs use `provider:modelPath` format (for example: `openrouter:anthropic/claude-haiku-4.5`).
- All wrapper calls must include `telemetry.functionId` (INV-19).

## Startup Wiring

`createAI()` is wired in `apps/backend/src/server.ts` with:

- `openrouter.apiKey` from backend config
- `costRecorder` (`AICostService`) for usage persistence

If OpenRouter is not configured, the wrapper throws loudly when a model is requested.

## Wrapper Operations

The wrapper exposes:

- `generateText`
- `generateObject`
- `embed`
- `embedMany`
- `getLangChainModel` (for LangGraph/LangChain flows)

All methods return normalized output and usage metadata, including OpenRouter cost when available.

## Cost Tracking

For AI SDK calls (`generateText`, `generateObject`, `embed`, `embedMany`):

- Pass `context` with `workspaceId` (and optionally `memberId`, `sessionId`, `origin`)
- Pass `telemetry.functionId`
- Usage is recorded through the injected `costRecorder` into `ai_usage_records`

For LangChain/LangGraph calls:

- Use `ai.getLangChainModel(modelId)`
- Use `ai.costTracker` with `getCostTrackingCallbacks(...)` from `apps/backend/src/lib/ai/cost-tracking-callback.ts`
- Wrap execution in `costTracker.runWithTracking(...)` so captured usage is persisted

## Repair Behavior

`generateObject` applies a default repair function (`stripMarkdownFences`) before schema parsing.

- Set `repair: false` to disable repair for a call
- Provide a custom `repair` function to override default behavior

## Related Docs

- `docs/model-reference.md` for approved models and capability guidance (INV-16)
- `docs/architecture.md` for backend architecture patterns
