# Agent Config As Override

## Goal

Move built-in agent defaults from Postgres seed/update rows into code-backed configuration, while keeping Postgres as a sparse workspace override layer. Ariadne remains the default built-in companion via the stable `persona_system_ariadne` ID, and workspace-managed personas continue to use full `personas` rows.

## What Was Built

### Built-In Agent Registry

Ariadne now has a code-defined base config with identity, prompt, model, temperature, max tokens, tools, and visibility. A locked-down empty agent is also registered as internal-only so it can be used later without appearing in workspace bootstrap.

**Files:**
- `apps/backend/src/features/agents/built-in-agents.ts` — built-in registry, Ariadne/empty agent defaults, patch schemas, and patch merge validation.
- `apps/backend/src/features/agents/companion/config.ts` — companion defaults now reference the Ariadne built-in config to avoid model drift.
- `apps/backend/src/features/agents/index.ts` — exports built-in config helpers and override repository.

### Sparse Postgres Overrides

Added an override table for workspace-specific built-in agent patches. Runtime validates patches with Zod and fails loudly for invalid override documents.

**Files:**
- `apps/backend/src/db/migrations/20260425164228_agent_config_overrides.sql` — creates `agent_config_overrides` and archives the historical Ariadne row.
- `apps/backend/src/features/agents/agent-config-override-repository.ts` — fetches active per-workspace override patches.

### Persona Resolution Boundary

`PersonaRepository` now synthesizes built-ins from code, applies workspace patches where a workspace is available, and falls back to `personas` for workspace-managed personas. Built-in Ariadne remains addressable by `persona_system_ariadne`; `getSystemDefault` returns Ariadne explicitly rather than relying on oldest active system row.

**Files:**
- `apps/backend/src/features/agents/persona-repository.ts` — resolves code-backed built-ins, patched built-ins, and DB personas through one API.
- `apps/backend/src/features/agents/companion-outbox-handler.ts` — resolves companion/default personas with workspace scope.
- `apps/backend/src/features/agents/persona-agent.ts` — runtime uses resolved persona config and forwards model options.
- `apps/backend/src/features/agents/companion/context.ts`, `apps/backend/src/features/agents/quote-resolver.ts`, `apps/backend/src/features/agents/researcher/context-formatter.ts`, `apps/backend/src/features/agents/tools/search-workspace-tool.ts`, `apps/backend/src/features/memos/explorer-service.ts`, `apps/backend/src/lib/ai/message-formatter.ts`, `apps/backend/src/features/activity/service.ts`, `apps/backend/src/features/public-api/handlers.ts`, `apps/backend/src/socket.ts`, `apps/backend/src/features/agents/session-handlers.ts` — pass workspace context into persona lookups so patched built-in display/config can resolve consistently.

### Runtime Model Options

The agent loop now forwards persona-level `temperature` and `maxTokens` into tool-capable generation, so these configurable fields affect the main companion loop.

**Files:**
- `apps/backend/src/lib/ai/ai.ts` — adds tool-generation `temperature` and `maxTokens` options.
- `apps/backend/src/features/agents/runtime/agent-runtime.ts` — forwards runtime config to the AI wrapper.
- `apps/backend/src/features/agents/runtime/agent-runtime.test.ts` — verifies forwarding behavior.

### Tests And Import Hygiene

Added direct coverage for base config resolution, workspace patch application, invalid patch failure, default disabling, workspace persona preservation, and internal empty-agent non-exposure. Also reordered messaging barrel exports so public API schemas can keep using feature barrels without reintroducing an initialization cycle.

**Files:**
- `apps/backend/src/features/agents/persona-repository.test.ts` — built-in/override resolution coverage.
- `apps/backend/src/lib/ai/config-resolver.test.ts` and `apps/backend/src/lib/ai/message-formatter.test.ts` — updated expected defaults/signatures.
- `apps/backend/src/features/messaging/index.ts` and `apps/backend/src/features/public-api/schemas.ts` — preserve INV-52 barrel imports while avoiding schema initialization issues.

## Design Decisions

### Code Owns Built-In Defaults

**Chose:** Ariadne and the empty agent are defined in `built-in-agents.ts`.
**Why:** Built-in behavior is product-managed and should change through code review rather than DB seed/update migrations.
**Alternatives considered:** Keep Ariadne as a full `personas` row with nullable override columns. This was rejected because it keeps defaults in data and requires schema changes for every configurable field.

### JSON Patch Overrides

**Chose:** Store sparse JSONB patches per `(workspace_id, agent_id)`.
**Why:** It keeps the base config in code while allowing any built-in configurable field to be overridden per workspace.
**Alternatives considered:** Typed nullable override columns. More explicit, but less flexible and migration-heavy.

### Preserve `personas` For Workspace Agents

**Chose:** Workspace-managed personas remain full DB rows.
**Why:** The user agent config surface is separate and should continue working as-is.
**Alternatives considered:** Move every persona through patch resolution now. This would unnecessarily broaden the change.

### Internal Empty Agent

**Chose:** Register the empty agent as `visibility: "internal"`.
**Why:** It prepares the runtime shape for multiple built-ins without exposing an unfinished product option.

## Schema Changes

- `apps/backend/src/db/migrations/20260425164228_agent_config_overrides.sql` creates `agent_config_overrides`.
- The same migration archives `persona_system_ariadne` so default behavior no longer comes from the historical seeded row.

## What's NOT Included

- No UI or public admin API for editing `agent_config_overrides`.
- No migration of workspace-managed personas into override patches.
- No exposure of the internal empty agent in workspace bootstrap or persona selection.
- No change to `scratchpadCustomPrompt`; user prompt preferences remain layered as before.

## Status

- [x] Built-in Ariadne config lives in code.
- [x] Sparse workspace override storage exists.
- [x] Runtime and bootstrap persona resolution apply overrides.
- [x] Workspace-managed personas remain DB-backed.
- [x] Tests cover built-in resolution and override behavior.
