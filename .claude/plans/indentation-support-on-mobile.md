# Mobile Editor Indentation Controls

## Goal

Add explicit indent and dedent controls to the mobile editor formatting bar so users can adjust indentation on phones and small touch devices without relying on hardware keyboard shortcuts.

## What Was Built

### Shared indentation commands

The editor's existing Tab and Shift+Tab behavior was extracted into reusable `indentSelection` and `dedentSelection` helpers so toolbar buttons and keyboard shortcuts both use the same command path.

**Files:**
- `apps/frontend/src/components/editor/editor-behaviors.ts` - exports shared indentation commands and routes keyboard Tab handling through them.
- `apps/frontend/src/components/editor/editor-behaviors.test.ts` - verifies indentation for regular text blocks and dedentation inside code blocks.

### Mobile formatting toolbar controls

The inline editor toolbar now supports an optional special input section with dedicated indent and dedent buttons. That section is only enabled for the mobile composer formatting bar, leaving the desktop selection toolbar and fullscreen editor toolbar unchanged.

**Files:**
- `apps/frontend/src/components/editor/editor-toolbar.tsx` - adds mobile-only indent/dedent buttons behind a dedicated prop.
- `apps/frontend/src/components/composer/message-composer.tsx` - enables the special input controls for the mobile inline formatting toolbar.
- `apps/frontend/src/components/editor/editor-toolbar.test.tsx` - verifies the buttons render only when enabled and dispatch the shared commands.
- `apps/frontend/src/components/composer/message-composer.test.tsx` - verifies the mobile formatting toolbar exposes the new controls.

## Design Decisions

### Reuse existing Tab behavior

**Chose:** Extract the existing keyboard indentation logic into exported helpers and have both keyboard shortcuts and toolbar buttons call them.
**Why:** This keeps indentation behavior consistent across desktop keyboards and mobile touch controls while minimizing new editor logic.
**Alternatives considered:** Implementing a separate toolbar-specific indentation path would duplicate complex selection handling and risk behavior drift.

### Scope controls to mobile inline formatting

**Chose:** Gate the new controls behind a toolbar prop and enable them only for the mobile inline formatting bar.
**Why:** The request was specifically for mobile style bar controls, and limiting the surface area keeps the desktop/floating toolbar unchanged.
**Alternatives considered:** Showing indent/dedent in every toolbar variant would add clutter and expand scope beyond the requested mobile improvement.

## Design Evolution

- **Command reuse vs new toolbar-only logic:** The implementation started from the mobile toolbar requirement, then folded the buttons into the existing Tab/Shift+Tab behavior by extracting shared commands so there is only one indentation implementation to maintain.

## Schema Changes

None.

## What's NOT Included

- No desktop toolbar changes beyond reusing the shared indentation helpers.
- No new editor node types or markdown serialization changes.
- No browser E2E coverage in this patch.

## Status

- [x] Added shared indent and dedent editor commands.
- [x] Added mobile-only indent and dedent controls to the inline formatting toolbar.
- [x] Added focused unit and component test coverage for the new behavior.
- [ ] Browser-level manual verification on a real mobile viewport.
