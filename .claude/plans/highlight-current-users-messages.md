# Highlight Current User's Messages

## Goal

Make it visually clear at a glance which messages in a conversation were sent by the current user vs other users. The app already differentiates persona (AI) and system messages with colored accents; user-to-user messages had no visual distinction.

## What Was Built

### Subtle background tint on current user's messages

Added a `bg-foreground/[0.03]` background tint to messages sent by the logged-in user. This follows the existing visual language where persona messages get a gold gradient and system messages get a blue gradient, but uses a much subtler flat tint to avoid dominating the conversation view.

**Files:**
- `apps/frontend/src/components/timeline/message-event.tsx` — Added `isCurrentUser` prop to `MessageLayoutProps`, conditional tint class in `MessageLayout`, and passed the prop from all three message event variants (`SentMessageEvent`, `PendingMessageEvent`, `FailedMessageEvent`)

## Design Decisions

### Flat tint vs gradient or accent bar

**Chose:** Flat `bg-foreground/[0.03]` background tint with no accent bar
**Why:** The user's own messages are the most frequent message type. A gradient + accent bar (like persona/system messages) would be too visually heavy. A 3% foreground opacity tint is just enough to create a visible "lane" without competing with the gold thread accent system.
**Alternatives considered:** Right-side accent bar, avatar ring + "you" badge, combined tint + accent bar. User chose the soft tint approach.

### Using foreground color at low opacity

**Chose:** `bg-foreground/[0.03]` rather than a specific hue
**Why:** The foreground color adapts naturally to both light and dark themes — warm-tinted in light mode, cool-tinted in dark mode. No need for separate dark mode overrides.

### Pending/Failed messages always marked as current user

**Chose:** Pass `isCurrentUser` unconditionally (boolean shorthand) on `PendingMessageEvent` and `FailedMessageEvent`
**Why:** Only the current user can have pending or failed messages — they always originate from the local client.

## Visual Hierarchy (resulting)

| Actor | Background | Left accent |
|-------|-----------|-------------|
| Persona (AI) | Gold gradient 6% | 3px gold bar |
| System | Blue gradient 4% | 3px blue bar |
| Current user | Foreground 3% flat | None |
| Other users | None (default) | None |

## What's NOT Included

- No "You" badge or label next to the username — kept minimal
- No avatar ring treatment — the tint is sufficient signal
- No right-side accent bar — user preferred the softer approach
- No changes to dark mode theme variables — `foreground/[0.03]` adapts automatically

## Status

- [x] Add `isCurrentUser` prop to `MessageLayout`
- [x] Apply subtle background tint for current user messages
- [x] Pass prop from `SentMessageEvent` (with ID comparison)
- [x] Pass prop from `PendingMessageEvent` and `FailedMessageEvent`
- [x] Verified visually in dev:test mode
- [x] TypeScript typecheck passes
