# THR-50: Multi-Region Workspace Handling — UI & Docs

## Goal

Complete the remaining THR-50 requirements: surface the workspace's data region in the UI so users can see where their data lives, and document how region migration would work if needed. The core multi-region infrastructure (workspace router, control plane, backend-common, KV-cached routing) was already shipped.

## What Was Built

### Region display name utility

A thin frontend utility that maps AWS-style region IDs (`eu-north-1`) to human-friendly labels ("Europe (Stockholm)"). Falls back to the raw ID for unknown regions.

**Files:**
- `apps/frontend/src/lib/regions.ts` — `REGION_LABELS` map and `formatRegion()` function

### General tab in workspace settings

Replaced the placeholder text in the workspace settings General tab with a `GeneralTab` component that shows workspace metadata. Uses the cache-only observer pattern (same as `UsersTab`) to read from the workspace bootstrap cache.

Displays:
- **Name** — read-only text
- **Data region** — formatted label with descriptive note; conditionally rendered (hidden when `workspace.region` is undefined for old workspaces)
- **Created** — preference-aware formatted date via `useFormattedDate()`

**Files:**
- `apps/frontend/src/components/workspace-settings/general-tab.tsx` — new component
- `apps/frontend/src/components/workspace-settings/workspace-settings-dialog.tsx` — import and render `GeneralTab` in place of placeholder

### Region picker display names

Updated the workspace creation region picker to show formatted region names instead of raw IDs.

**Files:**
- `apps/frontend/src/pages/workspace-select.tsx` — `{region}` → `{formatRegion(region)}`

### Region migration design doc

Lightweight design sketch documenting how workspace migration between regions would work. Covers why/what/how/risks/not-in-scope. Not a runbook — future reference for if/when migration tooling is needed.

**Files:**
- `docs/region-migration.md` — design sketch

## Design Decisions

### Cache-only observer for GeneralTab data access

**Chose:** Same `useQuery` with `enabled: false` + `staleTime: Infinity` pattern used by `UsersTab`
**Why:** Workspace bootstrap data is already loaded and cached. No need for a separate fetch. Follows the established cache-only observer pattern documented in CLAUDE.md.

### Conditional region rendering

**Chose:** `{workspace?.region && (...)}` — region section not rendered when region is undefined
**Why:** Old workspaces created before multi-region may not have a region field. Graceful omission is better than showing "Unknown" or a dash.

### Region labels as a frontend-only map

**Chose:** Simple `Record<string, string>` in a frontend utility file
**Why:** Region IDs are stable AWS identifiers. No need for a backend endpoint or shared package type. The map is tiny and display-only. New regions just need a line added to the map; unknown regions fall back to the raw ID.

## What's NOT Included

- **Workspace name editing** — the General tab shows the name read-only. Editing is a separate feature.
- **Region migration tooling** — only the design doc is included. No CLI, admin UI, or automated scripts.
- **Region selection after creation** — workspaces cannot change region through the UI. The migration doc covers the manual process.

## Status

- [x] Region display name utility (`formatRegion`)
- [x] General tab in workspace settings
- [x] Region picker uses display names
- [x] Region migration design doc
- [x] Typecheck passes
