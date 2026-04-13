# Expose Foundational Ariadne Tools Over the Public API

## Goal

Expose the foundational workspace-knowledge tools that Ariadne already has through the public API so external assistants can retrieve the same core business context directly from Threa. This branch focuses on stable retrieval primitives rather than agent-specific orchestration: message search improvements, memo search/detail, and attachment search/detail/download access.

## What Was Built

### Public API knowledge endpoints

Added memo and attachment retrieval endpoints to `/api/v1` so API key clients can search preserved workspace knowledge, inspect memo provenance, inspect extracted attachment content, and fetch signed attachment URLs.

**Files:**
- `apps/backend/src/features/public-api/schemas.ts` - Adds request schemas for memo and attachment search plus `exact` support for message search.
- `apps/backend/src/features/public-api/routes.ts` - Registers the new public API operations and their response schemas for OpenAPI generation.
- `apps/backend/src/features/public-api/handlers.ts` - Implements memo search/detail, attachment search/detail/url, and message exact-search wiring.
- `apps/backend/src/routes.ts` - Wires the new `/api/v1` endpoints behind the correct API key scope checks.
- `apps/backend/src/features/public-api/index.ts` - Re-exports the new public API request schemas.

### Public API permissions

Added explicit API key scopes for memo and attachment access so external agents can be granted these capabilities independently of stream or message permissions.

**Files:**
- `packages/types/src/api-keys.ts` - Adds `memos:read` and `attachments:read` to the shared API key scope/permission definitions.

### Attachment search safety gating

Kept public attachment detail and download behavior consistent with attachment sharing policy by limiting public attachment search to malware-cleared files only.

**Files:**
- `apps/backend/src/features/attachments/repository.ts` - Adds optional safety-status filtering to attachment search queries.
- `apps/backend/src/features/public-api/handlers.ts` - Uses the repository-level safety filter for public attachment search.

### Contract coverage and docs

Extended the OpenAPI spec and E2E coverage so the public contract reflects the new endpoints and response shapes.

**Files:**
- `apps/backend/scripts/generate-api-docs.ts` - Adds `Memos` and `Attachments` OpenAPI tags.
- `docs/public-api/openapi.json` - Regenerated public API spec with the new knowledge endpoints.
- `apps/backend/tests/e2e/public-api-search.test.ts` - Covers exact message search.
- `apps/backend/tests/e2e/public-api-openapi.test.ts` - Validates the new route schemas against the generated contract.
- `apps/backend/tests/e2e/public-api-knowledge.test.ts` - Covers memo search/detail and attachment search/detail/url, including blocked attachment behavior.

## Design Decisions

### Expose retrieval primitives, not the internal researcher

**Chose:** Add direct public endpoints for memo and attachment retrieval instead of exposing the workspace researcher.
**Why:** The point of this change is to let external agents build their own research loop while still using Threa as the business-context backend.
**Alternatives considered:** Exposing the workspace researcher as-is, which would couple external agents to Threa’s internal retrieval orchestration.

### Use dedicated read scopes for knowledge surfaces

**Chose:** Introduce `memos:read` and `attachments:read` instead of folding these APIs into existing message or stream scopes.
**Why:** External agents may need different least-privilege combinations, and these are distinct knowledge surfaces with different sensitivity and UX expectations.
**Alternatives considered:** Reusing `messages:read` or `messages:search`, which would make authorization blurrier and harder to reason about.

### Reuse existing memo and attachment domain services

**Chose:** Build the public API on top of `MemoExplorerService`, `AttachmentService`, and existing repositories rather than introducing a separate public-only retrieval stack.
**Why:** This keeps the patch small, preserves current retrieval behavior, and avoids parallel implementations.
**Alternatives considered:** New public-specific services, which would increase drift risk for behavior and access control.

### Keep attachment search aligned with sharing policy

**Chose:** Filter public attachment search to `clean` attachments only.
**Why:** Public detail and download already block pending or quarantined files, so search should not leak blocked attachment metadata or extracted content.
**Alternatives considered:** Returning blocked attachments from search but rejecting later on detail/download, which creates an inconsistent and weaker contract.

## Design Evolution

- **Parity scope narrowed:** The initial problem framing was broad Ariadne parity, but the implementation focused on foundational public retrieval tools first: memos, attachments, and exact message search.
- **Attachment search tightened after self-review:** The first pass exposed attachment search without the same malware-safety gate as detail/download. The final implementation moved that filter into the search query itself so blocked files are omitted without breaking `limit` semantics.

## Schema Changes

No database schema changes or migrations were required.

## What's NOT Included

- The internal `workspace_research` tool and its orchestration loop.
- Public equivalents for `load_attachment`, `load_pdf_section`, `load_file_section`, or `load_excel_section`.
- Broader Ariadne parity work such as MCP, CLI, or skill distribution.
- Stream-search parity improvements like DM participant-aware search behavior.

## Status

- [x] Added public API scopes for memos and attachments.
- [x] Added public memo search and memo detail endpoints.
- [x] Added public attachment search, detail, and signed URL endpoints.
- [x] Added exact-match support to public message search.
- [x] Regenerated the OpenAPI spec and extended contract coverage tests.
- [x] Aligned public attachment search with malware-sharing policy.
