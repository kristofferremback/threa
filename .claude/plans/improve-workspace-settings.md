# Settings Sidebar Consistency

## Goal

Extend the newer desktop sidebar settings layout beyond user settings so the other settings dialogs in the app use the same navigation pattern. The change keeps the existing mobile selector behavior and focuses on layout consistency rather than changing the underlying settings content.

## What Was Built

### Shared responsive settings navigation

Extracted the desktop sidebar navigation treatment into a small shared component that reuses the existing mobile `ResponsiveTabs` selector while rendering descriptive sidebar buttons on desktop.

**Files:**
- `apps/frontend/src/components/ui/responsive-settings-nav.tsx` - Shared responsive settings nav with desktop sidebar buttons and mobile tab selector reuse.

### User settings aligned to the shared shell

The existing user settings sidebar implementation now uses the shared navigation component instead of carrying an inline copy of the same desktop sidebar markup. The dialog also now includes an accessible description to satisfy the Radix dialog contract.

**Files:**
- `apps/frontend/src/components/settings/settings-dialog.tsx` - Swaps the inline sidebar nav for `ResponsiveSettingsNav` and adds a hidden dialog description.

### Workspace settings sidebar conversion

The workspace settings dialog now uses the same larger fixed-height desktop shell and left-hand sidebar navigation pattern as user settings. Tab metadata now includes short descriptions so the desktop nav communicates each section clearly.

**Files:**
- `apps/frontend/src/components/workspace-settings/workspace-settings-dialog.tsx` - Converts the old top-row tab layout to the sidebar shell and adds sidebar tab descriptions.

### Stream settings sidebar conversion

The stream settings dialog now uses the same shared desktop shell and responsive navigation pattern, while preserving its stream-type-specific tab filtering. DMs still only expose the members section; channels and scratchpads still expose the full tab set.

**Files:**
- `apps/frontend/src/components/stream-settings/stream-settings-dialog.tsx` - Converts the dialog shell to the sidebar layout and keeps stream-type-aware tab availability intact.

### Regression coverage

Added targeted tests for the two converted dialogs so the URL-driven workspace tab state and stream-type-specific tab filtering remain protected after the layout change.

**Files:**
- `apps/frontend/src/components/workspace-settings/workspace-settings-dialog.test.tsx` - Verifies sidebar navigation updates the `ws-settings` query param and renders the correct pane.
- `apps/frontend/src/components/stream-settings/stream-settings-dialog.test.tsx` - Verifies only the allowed sidebar items render for DM streams.

## Design Decisions

### Extract only the shared navigation, not a full dialog framework

**Chose:** Create a small `ResponsiveSettingsNav` helper and keep the dialog shells local to each settings dialog.
**Why:** The layouts are now visually aligned, but their state sources differ (`useSettings`, `useSearchParams`, and `useStreamSettings`). Extracting only the navigation keeps the patch small and avoids forcing a broader abstraction.
**Alternatives considered:** Building a larger generic settings dialog shell. Rejected because it would introduce more structural churn than this branch needs.

### Keep mobile behavior unchanged

**Chose:** Reuse `ResponsiveTabs` so mobile continues to use the existing select-based navigation.
**Why:** The request was specifically about matching the newer sidebar pattern, which only applies on desktop. The mobile interaction already fit the dialogs.
**Alternatives considered:** Redesigning mobile settings navigation too. Rejected as out of scope.

### Widen converted dialogs to match user settings

**Chose:** Give workspace and stream settings the same wider fixed-height desktop shell used by user settings.
**Why:** The sidebar layout needs more horizontal space than the older compact topbar shell, and keeping the shell sizes aligned makes the settings surfaces feel consistent.
**Alternatives considered:** Keeping the old narrow dialog width and only swapping the navigator. Rejected because it would make the content pane cramped next to the sidebar.

## Design Evolution

- **One-off sidebar conversion to shared nav extraction:** The direct ask was to make the remaining settings menus match the newer user settings layout. The final patch extracted the sidebar navigation instead of copying the same markup into multiple dialogs.
- **Layout-only change to accessibility cleanup too:** The initial implementation surfaced Radix dialog warnings in tests. The final version adds hidden dialog descriptions while touching the shells so the dialogs remain accessible.

## Schema Changes

None.

## What's NOT Included

- Any changes to the actual settings fields within user, workspace, or stream settings panes.
- Any new settings tabs or changes to tab availability rules beyond preserving existing behavior.
- A broader reusable settings-shell abstraction beyond the shared responsive navigation component.
- Mobile-specific design changes beyond continuing to reuse the existing responsive selector pattern.

## Status

- [x] Extract shared responsive settings sidebar navigation.
- [x] Move user settings to the shared nav component.
- [x] Convert workspace settings to the sidebar shell.
- [x] Convert stream settings to the sidebar shell.
- [x] Add focused regression tests for converted dialogs.
- [x] Run targeted frontend tests and frontend typecheck.
