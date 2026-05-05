# Link-Based Invitations

## Problem

Today, inviting a user to a workspace is **email-first**: an admin types an email address, the regional backend writes a `workspace_invitations` row, the control-plane shadow calls WorkOS `sendInvitation`, and WorkOS emails the recipient a magic link tied to that exact address.

This is a poor fit for the smallest version of the product. For a two-person scratchpad, a five-person hobby project, a startup that hasn't bought a domain yet — "type your friend's email and wait for them to find a verification message" is more friction than value. The natural way to invite someone to a small group is to message them: Signal, SMS, "drop your email here." The existing flow does not support that — there is no invitation primitive that exists _before_ the invitee's email is known.

We want to invert the flow: an admin **creates a link**, sends it through any channel, and the recipient supplies their own email when they claim it.

WorkOS does not ship this primitive. `sendInvitation` requires `email` and binds the token to that address at creation. The "shareable link" language in WorkOS docs refers to either Admin Portal setup links (a different feature) or the fact that an email-bound invitation URL can be delivered out-of-band — the email is still committed at create time. So this feature is ours to build, on top of the existing email-invite rails.

## Goal

Ship a second kind of workspace invitation:

1. **Admin creates a link invite** with a role and an optional admin-only note ("for Simon — sent via Signal").
2. **Admin sends the link** through any channel.
3. **Recipient opens the link, unauthenticated**, sees the workspace name + a single email field.
4. **Recipient submits their email** — we hand off to the existing WorkOS-verification rails, the existing `acceptPendingForEmail` post-login path completes membership.
5. **Single-use only** for v1: the first successful claim transitions the invitation to `accepted`. Subsequent attempts on the same link are rejected.

Email invites continue to work unchanged. Both kinds appear in the same admin list.

## Non-goals

- **Multi-use links.** Single-use only. Multi-use ("post one link in our Discord, anyone can join") is easy to add later by adding a `max_uses` column and removing the cap, but it changes the threat model — no per-recipient revoke, no per-recipient audit. Out of scope for v1.
- **Skipping WorkOS email verification.** We could redirect the claimer straight into WorkOS hosted auth and accept whatever email they sign in with, but that would let any signed-in WorkOS user with any email claim the seat, including one that doesn't belong to them via password signup. Going through `sendInvitation` after claim costs one extra email but inherits WorkOS's email-verification semantics for free.
- **Anonymous accept.** The recipient must still authenticate through WorkOS to be added to the workspace. We are removing email from the _creation_ step, not from the _membership_ step.
- **Cross-workspace links.** A link is bound to one workspace at create time. INV-8 stands.
- **Custom claim URLs.** The link format is fixed (`/join/:token`).
- **Backoffice "workspace owner invitations".** Separate surface in `features/backoffice/`, not in scope.

## Terminology

- **Email invite** — the existing invitation primitive: `kind = 'email'`, `email` set at creation, propagated to WorkOS at creation.
- **Link invite** — the new primitive: `kind = 'link'`, `email` null at creation, `token_hash` set at creation, `note` optional. Email gets bound + WorkOS invitation triggered at claim time.
- **Token** — opaque 32-byte random value, base64url-encoded. Returned in plaintext exactly once on create. Stored as SHA-256 hash on disk.
- **Claim** — the one-shot atomic transition where the recipient supplies their email. After claim, the invitation looks indistinguishable from an email invite for the rest of the lifecycle.

## Architecture

### Where things live

The split mirrors the existing email-invite flow:

- **Regional backend** (`apps/backend/src/features/invitations/`) — owns invite creation. Admin-auth, workspace-scoped (INV-8), already where `sendInvitations` lives. A new `createLink` service method writes one `workspace_invitations` row with `kind='link'`, `email=NULL`, `token_hash`, optional `note`, plus an `invitation:link-created` outbox event.
- **Control-plane** (`apps/control-plane/src/features/invitation-shadows/`) — owns the public-facing token surface. The `/join` page is unauthenticated and origin-agnostic; CP is the only service the workspace-router can route there without a region hint. CP also already owns WorkOS calls, the cross-region shadow table, and the existing user-facing accept endpoint (`POST /api/invitations/:id/accept`).
- **Outbox + shadow-sync** (`apps/backend/src/features/invitations/shadow-sync-outbox-handler.ts`) — extended to propagate `kind`, `note`, `token_hash` to CP via a new `createInvitationShadow` payload shape.

CP is the source of truth for the token lookup. Regional backend is the source of truth for everything else (status lifecycle, role, list-by-workspace).

### Data model

Add columns to **both** tables (regional `workspace_invitations` and CP `invitation_shadows`):

```sql
ALTER TABLE workspace_invitations
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'email',
  ADD COLUMN token_hash TEXT,
  ADD COLUMN note TEXT,
  ALTER COLUMN email DROP NOT NULL;

CREATE UNIQUE INDEX idx_workspace_invitations_token_hash
  ON workspace_invitations (token_hash) WHERE token_hash IS NOT NULL;
```

- `kind TEXT NOT NULL DEFAULT 'email'` — `'email' | 'link'`. Validated in code (INV-3).
- `email TEXT NULL` — required for `kind='email'`, null at creation for `kind='link'`, populated at claim. Validated in code.
- `token_hash TEXT NULL` — required for `kind='link'`, null for `kind='email'`. Stored as `sha256(token)` hex. Plaintext token never persisted.
- `note TEXT NULL` — admin-only memo, optional, surfaced in the admin list, never returned by the public token-lookup endpoint.

Single-use is enforced by the existing `status` lifecycle (`pending → accepted | revoked | expired`). The atomic `UPDATE … WHERE status='pending' RETURNING …` claim guarantees one winner (INV-20). No `max_uses` column.

The same migration columns land on `invitation_shadows` on CP. The regional `email` is mirrored to CP at claim time via a new `invitation:link-claimed` outbox event so CP can drive WorkOS `sendInvitation`.

### Token lifecycle

```
create-link (regional)
  → row { kind='link', email=NULL, token_hash, note, status='pending' }
  → outbox 'invitation:link-created'
  → shadow-sync calls CP createInvitationShadow(token_hash, kind='link', note=null|note)
                 (CP shadow gets the hash but never the note — admin memo stays regional)

friend opens /join/<token> (CP, unauthenticated)
  → GET /api/invitations/lookup?token=<token>
  → CP looks up by sha256(token), returns { workspaceName, expiresAt, status }
  → Never returns email, role, note, inviter, or token-derived material

friend submits email + clicks Continue (CP, unauthenticated)
  → POST /api/invitations/claim { token, email }
  → Atomic UPDATE on regional via internal API: claim row → set email, return invitation row
       (CP cannot mutate regional state directly — it forwards to regional via RegionalClient.claimInvitationLink)
  → Regional emits 'invitation:link-claimed' outbox event
  → Shadow-sync mirrors email to CP shadow
  → CP triggers WorkOS sendInvitation(email, organizationId, role)

friend gets WorkOS email, signs in / signs up
  → existing /api/auth/callback flow
  → existing acceptPendingForEmail picks up the now-email-bound invitation
  → existing acceptShadow path runs to completion
  → user lands on /w/<workspaceId>/setup
```

The atomic claim happens on the regional backend, not on CP, because the regional row is the source of truth for status. CP forwards via a new internal endpoint `POST /internal/workspaces/:workspaceId/invitations/claim-link` (region inferred from the shadow row).

### Race / concurrency notes

- **Two friends open the same link.** First `POST /api/invitations/claim` wins via `UPDATE … SET email = $1, status = 'pending' WHERE id = $2 AND status = 'pending' AND email IS NULL RETURNING …`. Second sees status conflict, gets a 409 "link already used."
- **Friend submits email, then revokes happens.** The atomic claim's `WHERE status='pending'` filter means revoke wins if it commits first; claimer sees 409.
- **Friend submits email, never completes WorkOS auth.** Invitation sits as `pending` with email bound. From the admin's view it looks indistinguishable from a stuck email invite. Existing expiry sweep handles cleanup.
- **WorkOS `sendInvitation` fails after claim.** The claim is durable; the WorkOS call is best-effort with logging, exactly like the existing `createShadow` path. Admin can resend.
- **Bound email already an existing workspace member.** Today's `sendInvitations` skips with `already_user`. Same behavior here, but at claim time: claim succeeds, regional checks `UserRepository.findEmails`, returns `{ alreadyMember: true, workspaceId }` so the join page can redirect straight into WorkOS auth.

### Invariants applied

- **INV-1, INV-3, INV-17**: append-only migration, no FKs, `kind` is `TEXT` validated in code.
- **INV-20**: claim is one atomic `UPDATE … RETURNING`, no select-then-update.
- **INV-4**: regional → CP propagation via outbox shadow-sync, not direct calls.
- **INV-6**: services own transactions; the claim is a single tx wrapping the row update + outbox insert.
- **INV-8**: `workspace_id` carried on every write.
- **INV-30, INV-41**: WorkOS calls happen _after_ the regional tx commits, no DB connection held during HTTP work.
- **INV-55**: all inputs validated with Zod (`tokenLookupSchema`, `claimSchema`, `createLinkSchema`).
- **INV-32**: failures throw `HttpError` with explicit `code` (`INVITATION_NOT_FOUND`, `INVITATION_REVOKED`, `INVITATION_EXPIRED`, `INVITATION_ALREADY_CLAIMED`).
- **INV-14, INV-40**: frontend uses Shadcn primitives + `<Link>` for navigation, `<Button>` for actions.
- **INV-46**: backend returns structured data; the frontend formats display strings.

## API surface

### Regional backend (admin-auth)

`POST /api/workspaces/:workspaceId/invitations/links`

```
body: { role: 'admin' | 'user', note?: string, expiresInDays?: number }
200:  { invitation: WorkspaceInvitation, token: string, joinUrl: string }
```

The `token` and `joinUrl` are returned **once**. After this response, only the hash exists.

`GET /api/workspaces/:workspaceId/invitations` — extended to include link kind and `note`. Payload shape adds `kind`, `email` becomes nullable, `note` optional.

Existing `revoke` and `resend` endpoints work unchanged for both kinds. (Resend on a link invite is a no-op past the claim — pre-claim there's nothing to resend; the admin can revoke + create a new link.)

### Control-plane (public / unauthenticated)

`GET /api/invitations/lookup?token=<token>`

```
200: { workspaceName: string, expiresAt: string, status: 'pending' | 'accepted' | 'revoked' | 'expired' }
404: { code: 'INVITATION_NOT_FOUND' }
```

Returns only the workspace name. Never role, note, email, or inviter identity.

`POST /api/invitations/claim`

```
body: { token: string, email: string }
200:  { ok: true, alreadyMember?: { workspaceId: string } }
409:  { code: 'INVITATION_ALREADY_CLAIMED' | 'INVITATION_REVOKED' | 'INVITATION_EXPIRED' }
404:  { code: 'INVITATION_NOT_FOUND' }
```

On success, the user is told to check their email for a sign-in link from WorkOS. If they're already a member of the workspace via a different login, the response carries `alreadyMember.workspaceId` and the frontend can either deep-link them to login or — if their session is somehow already valid — straight into the workspace.

### Internal (CP → regional)

`POST /internal/workspaces/:workspaceId/invitations/claim-link`

Forwarded by CP after token-hash lookup. Carries the token hash + email. Atomic claim runs here.

## Frontend

Two surfaces touched:

### 1. Workspace settings → Users tab → Pending invitations

Today there is only one invite path ("Invite Users" → email textarea). We add a sibling.

The "Invite" button becomes a `DropdownMenu` trigger:

- "Invite by email…" → existing `InviteDialog`
- "Create invite link…" → new `CreateInviteLinkDialog`

`CreateInviteLinkDialog` form: role select (User / Admin), optional note input, "Create link" button. On success, the dialog swaps to a "Copy link" view with a one-time read-only display of the URL and a copy button. The token is **never** retrievable after this.

The pending-invitations list extends to show both kinds:

```
┌────────────────────────────────────────────────────────────────┐
│ simon@acme.com                       [user]   Expires May 12   │
│                                                  Resend  Revoke │
├────────────────────────────────────────────────────────────────┤
│ Link invite                          [admin]   Expires May 12  │
│ "for Simon — sent via Signal"                                  │
│                                            Copy link  Revoke   │
└────────────────────────────────────────────────────────────────┘
```

Visual rules to follow:

- Re-use the existing `rounded-md border px-3 py-2` row container so link rows sit flush with email rows.
- A `Badge` carries the role (matches today). A second `Badge` with `variant="outline"` differentiates kind ("Email" / "Link") so the row scans even when collapsed on mobile.
- The note renders below the headline as `text-xs text-muted-foreground` and is truncated. Hover reveals full via `<Tooltip>` if truncated.
- "Copy link" only works for link invites and only while the in-memory token is still available (right after creation). Reloading the page clears the in-memory token and replaces the action with a disabled "Link sent" state — there is no API to retrieve the plaintext token after creation.

### 2. Public `/join/:token` page

A new top-level route, lazy-loaded, sibling of `/login`. Lives outside `WorkspaceLayout` — no workspace bootstrap needed.

States the page renders:

1. **Loading** — skeleton with `ThreaLogo` (matches `WorkspaceSelectPage` loading state).
2. **Found** — workspace name, "You've been invited to join _Acme_", email input, Continue button. Mirrors `UserSetupPage` form spacing exactly: `max-w-md`, `space-y-6 p-6`, `Label` + `Input` pairs in `space-y-2` blocks, primary `Button` is full-width.
3. **Email submitted** — switches to a "Check your inbox" state with the bound email and a "Didn't get it? Open Sign in" fallback that goes to `/login`.
4. **Error states**:
   - Not found → "This invitation link is invalid or expired."
   - Revoked → "This invitation has been revoked. Ask the workspace admin for a new link."
   - Already claimed → "This link has already been used."

Visual rules:

- Centered column on `bg-background`, `ThreaLogo` at top — same shell as `LoginPage` and `WorkspaceSelectPage`. Consistency over creativity.
- Workspace name rendered as `text-xl font-medium` matching the `WorkspaceSelectPage` welcome heading.
- Submit button uses the same `min-w-[200px]` pattern from login but stretched to `w-full` because it's inside a form, matching `UserSetupPage`.
- All error states render in `text-sm text-destructive` — same as `WorkspaceSelectPage` accept errors.
- Spacing, font weights, and border radii pulled from existing pages — no novel design tokens, no novel components.

## Migrations

- `apps/backend/src/db/migrations/<timestamp>_invitation_link_kind.sql` — add `kind`, `token_hash`, `note`, drop NOT NULL on `email`, partial unique index on `token_hash`.
- `apps/control-plane/src/db/migrations/005_invitation_link_kind.sql` — same shape on `invitation_shadows`.

Both use `IF NOT EXISTS` patterns where supported and follow INV-17 (append-only).

## Testing

- **Backend service tests** (`service.test.ts`):
  - Create link invite → row exists with `kind='link'`, `token_hash` set, `email` null.
  - Claim link with valid email → row updated, status still `pending`, email set, outbox event written.
  - Concurrent claim → exactly one wins, second gets 409.
  - Claim revoked link → 409.
  - Claim expired link → 409.
- **CP service tests**: shadow handles `kind='link'`, lookup hides note + email, claim forwards to regional.
- **Integration**: end-to-end flow with stub WorkOS service — create link, claim, then run existing `acceptPendingForEmail` and assert workspace membership.
- **Frontend integration tests**: `CreateInviteLinkDialog` renders + posts; `/join/:token` page renders loading → found → submitted → error states.
- **E2E** (Playwright): admin creates link, opens token URL in a fresh context, submits email, lands on the post-claim screen.

## Rollout

No feature flag. The feature is purely additive — existing email invites are untouched, and the new code paths only activate when `kind='link'` is supplied. The migration is backward-compatible (`kind` defaults to `'email'`, `email` becomes nullable).

## Open extensions (future)

- Multi-use links (`max_uses` int, defaults to 1, removes single-use cap).
- Per-link revoke without affecting other invites — already supported because each link is a distinct row.
- Tracking `claimed_by_workos_user_id` separately from `email` so we can audit "who actually used the link" if it ever supported multi-use.
- Optional name field on the `/join` page that gets passed through to `UserSetupPage` as a default.
