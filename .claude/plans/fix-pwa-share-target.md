# Fix PWA Share Target

## Goal

Restore the installed PWA share target so OS-level shares sent to Threa via `POST /share` are handled by the service worker instead of being forwarded to Cloudflare Pages.

## What Was Built

### Service Worker Share Target Routing

The generic app-shell navigation fallback now handles only `GET` navigations. Web Share Target launches use a `POST` navigation to `/share`, so those requests must fall through to the dedicated share-target fetch handler that reads multipart form data, stores it in the Cache API, and redirects to the share picker.

**Files:**
- `apps/frontend/src/sw.ts` - Adds a method guard to the network-first navigation handler so it ignores non-GET navigations.

## Design Decisions

### Keep Share Target Handling in the Existing Service Worker

**Chose:** Narrow the broad navigation handler to `GET` requests.

**Why:** The existing share-target implementation already handles `POST /share` correctly. The regression was caused by an earlier fetch listener intercepting all navigation requests before the share-target listener could respond.

**Alternatives considered:** Adding server-side support for `POST /share` would not preserve the existing file/text handoff through the Cache API and would expand the change beyond the browser-only PWA path.

## Design Evolution

- No significant design pivot. Investigation confirmed `GET /share` is reachable in production, while direct `POST /share` returns `405` outside a service-worker-controlled PWA context.

## Schema Changes

None.

## What's NOT Included

- No backend or Cloudflare Pages route changes.
- No manifest changes; the existing manifest already points the share target at `POST /share`.
- No UI changes to the workspace share picker.

## Status

- [x] Diagnosed the share-target POST interception issue.
- [x] Updated the service worker navigation handler to only catch GET navigations.
- [x] Verified the frontend production build and generated service worker compile successfully.
