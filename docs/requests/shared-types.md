# Shared Types Between Frontend and Backend

## Problem Statement

Frontend has duplicated type definitions that mirror the backend. These are maintained separately with "keep in sync" comments, which is error-prone and creates maintenance burden.

Files affected:

- `apps/frontend/src/types/domain.ts` - duplicates backend domain types
- `apps/frontend/src/api/streams.ts` - defines `StreamBootstrap` and other API response types

## Proposed Solution

Create a shared types package that both frontend and backend can import from.

### Option 1: Shared Package in Monorepo

```
packages/
  types/
    src/
      domain.ts      # Stream, Message, Workspace, etc.
      api.ts         # API request/response types
    package.json
```

Both apps would import: `import { Stream } from "@threa/types"`

### Option 2: Export from Backend, Import in Frontend

Backend already defines canonical types. Frontend could import directly:

```typescript
// In frontend
import type { Stream, StreamEvent } from "@threa/backend/types"
```

This requires configuring the backend as a TypeScript project reference.

## Implementation Steps

1. Create `packages/types` directory
2. Move shared type definitions there
3. Update both apps to import from shared package
4. Remove duplicated types from frontend
5. Set up TypeScript project references for proper IDE support

## Acceptance Criteria

- [ ] Single source of truth for domain types
- [ ] Both frontend and backend import from same location
- [ ] No "keep in sync" comments needed
- [ ] IDE autocomplete works correctly in both apps
