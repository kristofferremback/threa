# Browser Test Flake Reduction

## Goal

Stabilize the browser specs that have been failing repeatedly in CI by fixing both brittle test design and one real editor race, while trimming low-value browser coverage that adds noise without meaningfully protecting product behavior.

## What Was Built

### Editor Mention Reparse Deferral

The shared rich editor now defers cosmetic mention reparsing while the editor is focused. This prevents the first keystrokes after reload from being replaced when mention metadata finishes loading, which was surfacing as an intermittent send-mode/browser interaction failure under slower CI conditions.

**Files:**
- `apps/frontend/src/components/editor/rich-editor.tsx` - defers mention reparsing until focus leaves the editor and tracks pending reparses explicitly

### Deterministic Browser Test Setup For Real Streams

Several flaky specs were relying on scratchpad drafts, broad text matches, or route transitions that are fast locally but unstable on congested runners. Those specs now create stable channels/streams up front, scope assertions to rendered message items, and wait for real stream routes before asserting behavior.

**Files:**
- `tests/browser/edit-last-message.spec.ts` - replaces scratchpad setup with deterministic channel setup, scopes message assertions, and uses a fresh browser context for the bootstrap-window check
- `tests/browser/infinite-scroll.spec.ts` - seeds messages off-route, hardens scroll-to-top behavior, and polls for actual paged content instead of request timing
- `tests/browser/drafts-modal.spec.ts` - targets the panel editor explicitly and finds the thread draft by preview content instead of assuming sort order
- `tests/browser/message-send-mode.spec.ts` - moves preference persistence coverage onto a real channel stream and narrows the test to persistence instead of scratchpad promotion behavior

### Thread Panel Retry And Promotion Hardening

The thread-related flakes were concentrated around draft-thread promotion and panel remount timing. The thread suites now share explicit panel-editor targeting, send through the visible panel action, wait for draft panels to settle into real threads, and retry transient failed sends instead of assuming the first draft-thread send always sticks under load.

**Files:**
- `tests/browser/thread-replies.spec.ts` - adds panel send helpers, retry-aware draft-to-thread settling, and breadcrumb-based returns to the main stream
- `tests/browser/nested-thread-navigation.spec.ts` - adds the same panel send/settling helpers and reply-action polling for nested thread navigation
- `tests/browser/thread-breadcrumbs.spec.ts` - scopes reply actions to actual message items and targets the panel editor explicitly for nested breadcrumb coverage

### Browser Suite Value Cleanup

The sidebar suite previously contained multiple tests that mostly re-verified browser/library behavior or documented known gaps without asserting a stable, high-value user story. Those tests were removed so the suite stays focused on cases where browser coverage is the right level of protection.

**Files:**
- `tests/browser/sidebar-updates.spec.ts` - removes low-value Bug 1/2/3 coverage, keeps the meaningful sidebar-refresh scenarios, and hardens scratchpad-to-stream route settling

## Design Decisions

### Fix The Real Editor Race Instead Of Only Relaxing Tests

**Chose:** Patch `RichEditor` so mention reparsing waits until the editor is unfocused.
**Why:** The flaky send-mode persistence failures were partly exposing a real user-facing race where async mention metadata could clobber newly typed text after reload.
**Alternatives considered:** Adding longer waits in the browser test. Rejected because it would hide a real product defect without making the editor safer.

### Prefer Stable Real Streams Over Draft Scratchpads In Persistence Tests

**Chose:** Move sensitive browser specs onto real channel streams created explicitly for the test.
**Why:** Scratchpad draft creation and draft-to-stream promotion add unrelated timing transitions that make CI failures hard to interpret.
**Alternatives considered:** Keeping scratchpad coverage and layering more waits around route promotion. Rejected because it still couples the tests to a second behavior under load.

### Wait For Observable UI State, Not Network Timing

**Chose:** Poll for visible UI outcomes such as rendered message items, visible reply actions, settled stream URLs, and panel send controls.
**Why:** Weak GitHub runners make single-event timing assumptions unreliable, while observable UI state is what the user actually depends on.
**Alternatives considered:** Asserting request counts or sprinkling fixed sleeps. Rejected because those approaches are brittle and do not prove user-visible behavior.

### Remove Browser Tests That Do Not Earn Their Runtime Cost

**Chose:** Delete the low-value sidebar bug-documentation tests instead of endlessly hardening them.
**Why:** The suite should prioritize end-to-end user stories and real browser-only interactions, not maintain noisy specs that mostly assert transient implementation details.
**Alternatives considered:** Keeping the tests as documentation. Rejected because recurring CI noise is a real maintenance cost and the remaining sidebar specs cover the behavior that matters more directly.

## Design Evolution

- **Message-send-mode flake investigation:** The initial suspicion was a pure browser-test timing bug. Reproduction work showed that reload-time mention reparsing could overwrite active typing, so the final patch combines a product fix with a narrower persistence test.
- **Thread panel stabilization:** The first hardening pass only waited for the draft thread to promote to a real thread. Full-suite reruns exposed transient failed sends in draft panels, so the final helpers also detect and retry visible `Retry` states before continuing.
- **Infinite-scroll verification:** The original test watched pagination requests and assumed one scroll event would be enough. The final version verifies that older messages actually render and re-drives the scroller until the user-visible result appears.
- **Sidebar cleanup:** The initial pass treated all recurring sidebar failures as candidates for stabilization. Reviewing their value showed several specs were weak regressions with poor signal, so the final suite removes them and keeps only the stronger end-to-end stories.

## Schema Changes

None.

## What's NOT Included

- No broad rewrite of the browser test helper layer beyond the unstable specs touched here
- No attempt to increase browser-suite scope; the direction is fewer, stronger browser tests
- No changes to unrelated frontend/editor behavior outside the reload-time mention reparse race
- No attempt to make CI runners faster or change GitHub Actions resource allocation

## Status

- [x] Identify recurring browser CI failures from recent runs
- [x] Separate low-value flaky coverage from product-significant failures
- [x] Fix the editor reload race contributing to composer flakiness
- [x] Harden the recurring flaky specs around stream creation, scrolling, and thread-panel promotion
- [x] Remove low-value sidebar browser tests that were not worth stabilizing
- [x] Verify the targeted flaky specs in isolation and under parallel stress
- [x] Run the full browser suite successfully after the fixes
