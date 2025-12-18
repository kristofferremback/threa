# Shared Types Package - Work Notes

**Started**: 2025-12-18
**Branch**: shared-types
**Status**: Complete

## Problem Statement

Frontend has duplicated type definitions that mirror the backend. These are maintained separately with "keep in sync" comments, which is error-prone and creates maintenance burden.

Files affected:

- `apps/frontend/src/types/domain.ts` - duplicates backend domain types
- `apps/frontend/src/api/streams.ts` - defines `StreamBootstrap` and other API response types

## Session Log

### 2025-12-18 - Initial Analysis

**Context reviewed**:

- `apps/frontend/src/types/domain.ts` - Frontend type definitions (string-based timestamps)
- `apps/frontend/src/api/streams.ts` - API types like StreamBootstrap
- `apps/backend/src/lib/constants.ts` - Canonical constants (STREAM_TYPES, etc.)
- `apps/backend/src/repositories/*.ts` - Backend domain types (Date/bigint-based)
- `apps/backend/src/lib/serialization.ts` - BigInt/Date serialization for JSON
- `apps/backend/src/handlers/stream-handlers.ts` - How responses are serialized

**Key findings**:

1. **Type divergence**:
   - Backend: `Date` objects, `bigint` for sequences
   - Frontend: `string` for timestamps (ISO), `string` for sequences
   - Wire format: JSON serialization converts Date→string, serializeBigInt converts bigint→string

2. **Constants are identical** between frontend and backend (STREAM_TYPES, COMPANION_MODES, etc.)

3. **Frontend uses wire types as domain types** - no Date parsing, works with ISO strings throughout (only parses to Date for display in `relative-time.tsx`)

4. **Backend internal types should stay internal** - repositories need Date/bigint for database operations

**Applicable invariants**: INV-1 (no FK), INV-3 (no DB enums)

---

## Key Decisions

### Type Architecture

**Choice**: Shared package defines wire types (string-based), backend keeps internal Date/bigint types

**Rationale**:

1. Wire types are what both apps communicate with
2. Backend internal types are implementation details (Date for DB, bigint for sequences)
3. Frontend uses wire types directly without conversion
4. Single source of truth for API contracts

**Alternatives considered**:

- Share domain types (Date/bigint) - requires frontend to parse all timestamps, adds complexity
- Share both - more types to maintain, unclear which to use when
- Export from backend - creates coupling, requires complex tsconfig project references

### Package Structure

**Choice**: Create `packages/types` with:

```
packages/types/
├── src/
│   ├── index.ts          # Re-exports everything
│   ├── constants.ts      # STREAM_TYPES, COMPANION_MODES, etc.
│   ├── domain.ts         # Core entities (User, Stream, Message, etc.)
│   └── api.ts            # API request/response types (CreateStreamInput, StreamBootstrap)
├── package.json
└── tsconfig.json
```

**Rationale**: Clear separation between constants, domain entities, and API contracts

---

## Implementation Plan

### Phase 1: Create Package Structure

- [x] Create `packages/types` directory
- [x] Create `package.json` with name `@threa/types`
- [x] Create `tsconfig.json`
- [x] Update root `package.json` workspaces to include `packages/*`

### Phase 2: Define Shared Types

- [x] Move constants from backend to shared package
- [x] Define wire types for all domain entities
- [x] Define API types (request/response shapes)

### Phase 3: Update Backend

- [x] Import constants from `@threa/types`
- [x] Keep internal Date/bigint types in repositories
- [x] Backend continues to use serializeBigInt for responses

### Phase 4: Update Frontend

- [x] Import from `@threa/types` instead of local types
- [x] Remove `apps/frontend/src/types/domain.ts`
- [x] Update API files to import shared types

### Phase 5: Verification

- [x] Run backend tests (58 tests pass)
- [x] Run frontend build (Vite build succeeds)
- [x] Verify imports resolve correctly

---

## Open Questions

None currently.

---

## Files to Modify

**Create**:

- `packages/types/package.json`
- `packages/types/tsconfig.json`
- `packages/types/src/index.ts`
- `packages/types/src/constants.ts`
- `packages/types/src/domain.ts`
- `packages/types/src/api.ts`

**Modify**:

- `package.json` - add `packages/*` to workspaces
- `apps/backend/src/lib/constants.ts` - import from shared
- `apps/backend/src/repositories/*.ts` - import constants from shared
- `apps/frontend/src/types/domain.ts` - DELETE (replaced by shared)
- `apps/frontend/src/api/streams.ts` - import from shared
- Various frontend files importing from `@/types/domain`
