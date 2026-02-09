# ADR-001: Feature Colocation

## Status

Accepted

## Context

The backend uses layer-based organization (`handlers/`, `services/`, `repositories/`, `lib/`, `workers/`). Understanding or modifying one feature requires jumping across 5+ directories. The `lib/` directory mixes true infrastructure with domain-specific outbox handlers, AI classifiers, and business logic.

This was identified as the #1 maintainability bottleneck. Adding a field to memos requires touching files in `handlers/`, `services/`, `repositories/`, `lib/memo/`, `lib/memo-accumulator-handler.ts`, and `workers/memo-batch-worker.ts`.

## Decision

Introduce `features/` domain slices that colocate all layers of a feature together. Genuinely cross-cutting infrastructure stays in `lib/`.

### Feature Slice Convention

```
features/<name>/
  index.ts              # Barrel - public API for other features
  handlers.ts           # HTTP route handler factory
  service.ts            # Business logic (class w/ Pool)
  repository.ts         # Data access (static methods)
  outbox-handler.ts     # Outbox event handler (if applicable)
  worker.ts             # Job queue worker (if applicable)
  config.ts             # AI config, prompts, schemas (if applicable)
  types.ts              # Feature-local types (if needed)
  *.test.ts             # Tests colocated next to source
```

### Import Rules

1. Features import from `lib/` (infrastructure) freely
2. Features import from other features via barrel `features/x/index.ts` only — never internals
3. `lib/` never imports from `features/`

### Registration

Central registration files (`routes.ts`, `server.ts`) keep their structure but update import paths. This preserves the single overview of the API surface and service wiring.

## Consequences

### Positive

- All code for one feature is in one directory
- Adding/modifying a feature requires touching one directory
- `lib/` shrinks to genuine infrastructure (~35 files from ~89)
- Feature boundaries become explicit and enforceable via ESLint

### Negative

- Large migration (many file moves, import updates)
- Barrel re-export shims needed during transition
- Some files are shared across features (e.g., `stream-state-repository` used by both streams and memos)

### Enforcement

- ESLint `no-restricted-imports`: `lib/` cannot import `features/`, features cannot reach into other feature internals
- CLAUDE.md invariants: INV-51 (Feature Colocation), INV-52 (Feature Barrel Imports)
