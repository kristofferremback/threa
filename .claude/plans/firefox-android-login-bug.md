# Firefox Android Login Redirect Fix

## Goal

Fix a mobile Firefox login loop where WorkOS authentication succeeds, but the app redirects back to login after returning from the callback because the authenticated session is not recognized.

## What Was Built

### Session cookie helpers

Centralized session cookie set and clear behavior in `backend-common`. When the configured session cookie is domain-scoped, setting a new session now first clears the host-only cookie variant with the same name, and clearing a session clears both variants.

**Files:**

- `packages/backend-common/src/cookies.ts` — adds `setSessionCookie` and `clearSessionCookie`.
- `packages/backend-common/src/index.ts` — exports the new helpers and option type.
- `packages/backend-common/src/cookies.test.ts` — verifies host-only cleanup when domain-scoped cookies are set or cleared.

### Auth path adoption

Updated all session-writing auth paths touched by this bug to use the shared helpers.

**Files:**

- `apps/control-plane/src/features/auth/handlers.ts` — WorkOS callback uses `setSessionCookie`; logout uses `clearSessionCookie`.
- `packages/backend-common/src/auth/middleware.ts` — session refresh and expired-session cleanup use the shared helpers.
- `apps/control-plane/src/features/auth/stub-handlers.ts` — control-plane stub login uses `setSessionCookie`.
- `apps/backend/src/auth/auth-stub-handlers.ts` — regional backend stub login uses `setSessionCookie` with its existing test/dev secure override.

## Design Decisions

### Clear host-only shadow cookies at write time

**Chose:** Clear the host-only variant before setting the domain-scoped session cookie.

**Why:** The staging-specific cookie work made `SESSION_COOKIE_NAME` and `COOKIE_DOMAIN` configurable. A browser can retain an older host-only cookie and also store the newer `.threa.io` cookie under the same name. If Firefox Android sends those duplicates in an order where the stale value is parsed first, `/api/auth/me` sees an invalid session and the frontend returns to login.

**Alternatives considered:** Parsing duplicate cookie headers server-side and trying later values. That would make request handling depend on browser ordering and still leave stale cookies in the jar.

### Keep cookie behavior centralized

**Chose:** Add helpers in `packages/backend-common/src/cookies.ts` instead of patching only the WorkOS callback.

**Why:** The same session cookie is written during callback login, stub login, and session refresh, and cleared during logout or failed authentication. Keeping all paths on one helper prevents future divergence.

## Design Evolution

- **Root cause narrowed:** Initial suspicion was a WorkOS redirect problem, but the callback already authenticates and redirects correctly. The app-side 401 after callback pointed to session cookie scope/selection instead.
- **Patch scope narrowed:** No frontend redirect change was needed; the fix belongs at the session cookie boundary.

## Schema Changes

None.

## What's NOT Included

- No WorkOS dashboard/configuration change.
- No frontend login-flow changes.
- No server-side fallback that accepts multiple possible session cookie names.

## Status

- [x] Add centralized session cookie set/clear helpers.
- [x] Apply helpers to WorkOS callback, logout, session refresh, and stub login paths.
- [x] Add focused cookie helper coverage.
- [x] Run focused unit test and relevant typechecks.
- [ ] Run control-plane auth E2E once Docker/test database is available.
