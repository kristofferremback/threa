# PR-4b — Cross-account entry resolver (backend primitive + frontend bare-link guard)

## Context

Fifth implementation slice of the multi-account login split
(`docs/plans/multi-account-login-split.md`). Prior slices are **merged to
`origin/main`** (HEAD `6782e487`): PR-1 (#537 cookie/auth primitives), PR-3
(#538 `/api/accounts` contract + OAuth `intent=add`), and **PR-4a (#540
AccountScope foundation — account-scoped data layer + in-place
`switchAccount` + keyed remount, no UI)**. Offline-first boot (#539) is also
merged and underneath PR-4a.

**Problem PR-4b solves:** opening an entry point that belongs to a *parked*
(non-active) account dead-ends — the active account's workspace bootstrap
returns `403/404` and `workspace-layout.tsx` bounces to `/workspaces` even
though this browser is signed into an account that owns it. PR-4b adds the
**resolve→flip→route primitive** so the right account can be flipped in
place (PR-4a `switchAccount`, keyed remount, no reload), preserving the
original deep link.

**Two distinct entry points (the key correctness distinction):**

1. **Member-scoped entry (notification — PR-6 reuses this).** A notification
   is tied to an Activity already scoped to a *specific recipient member*,
   so its payload carries that member's `workosUserId`. The resolver MUST
   flip to **exactly that account** and **never substitute** a different
   signed-in account that merely also has read access (e.g. signed into
   both A and B, B also in the workspace, mention is A's — must land as A,
   not B). If that exact account is not signed into this browser → 404 →
   caller does a full login as that user (no silent substitution).
2. **Bare workspace deep-link (PR-4b's only frontend trigger).** A shared
   `/w/:workspaceId` link with *no* member context. Membership is the only
   available selector and it can be ambiguous, so per product decision:
   resolve **only if exactly one** signed-in account is a member; **0 or
   2+ → 404** (caller keeps today's bounce; PR-5's switcher disambiguates
   the multi-member case). Never guess an arbitrary account.

So PR-4b's backend owns **one endpoint with two forms** — an exact-identity
form (the PR-6 primitive, fully built+tested now though PR-4b has no
notification UI) and a unique-membership form (consumed by PR-4b's frontend
guard). PR-6 becomes a trivial caller of the identity form.

**Correction to the PR-4a follow-up sketch (verified against
`origin/main`):** the sketch said the resolver "checks membership via the
`/internal/workspaces/:id/members/:uid` path." That internal route is for
the **regional backend → control plane** self-heal direction
(`apps/control-plane/src/routes.ts:190`, `internalAuth`). The resolve
endpoint itself lives **in the control plane**, the source of truth for
`workspace_memberships` (`ControlPlaneWorkspaceService.isMember`,
`apps/control-plane/src/features/workspaces/service.ts:69-71` →
`WorkspaceRegistryRepository.isMember`). PR-4b calls `isMember`
**in-process** — no internal HTTP hop, same data. Strictly better than the
sketch; the only material deviation.

## Approach

### 1. Backend — `AccountsService.resolve` (control plane)

`apps/control-plane/src/features/accounts/service.ts`

- Add a narrow injected dep (avoids INV-52 cross-feature concrete coupling;
  satisfies INV-10/12/13):
  ```ts
  interface MembershipChecker {
    isMember(workspaceId: string, workosUserId: string): Promise<boolean>
  }
  interface Dependencies { authService: AuthService; membership: MembershipChecker }
  ```
  `ControlPlaneWorkspaceService` already structurally satisfies
  `MembershipChecker` via its existing `isMember` — no new control-plane
  code, just wiring.
- One public method, branching on which form. Reuses the existing private
  `resolveAlts` (`service.ts:62-71`) verbatim and the file's
  **parallel-not-serial** idiom (INV-56):
  ```ts
  async resolve(
    cookies: Record<string, string>,
    activeUser: ActiveUser,
    q: { userId?: string; workspaceId?: string }
  ): Promise<{ ownerUserId: string }> {
    const alts = await this.resolveAlts(cookies)
    const seen = new Set<string>()
    const signedInIds = [activeUser.id, ...alts.flatMap((a) => (a.ok && a.user ? [a.user.id] : []))]
      .filter((id) => (seen.has(id) ? false : (seen.add(id), true)))

    if (q.userId) {
      // Identity form (PR-6 primitive): exact match, never substitute.
      if (!signedInIds.includes(q.userId)) {
        throw new HttpError("Account not signed in on this browser", {
          status: 404, code: "ACCOUNT_NOT_SIGNED_IN",
        })
      }
      // Defence-in-depth for a stale notification: the named account is
      // signed in but was removed from the workspace.
      if (q.workspaceId && !(await this.membership.isMember(q.workspaceId, q.userId))) {
        throw new HttpError("Account can no longer access this workspace", {
          status: 404, code: "WORKSPACE_NOT_RESOLVABLE",
        })
      }
      return { ownerUserId: q.userId }
    }

    // Bare workspace-link form (PR-4b): switch only if exactly one
    // signed-in account is a member; 0 or 2+ -> caller bounces.
    const wid = q.workspaceId!  // Zod refine guarantees one of the two
    const flags = await Promise.all(signedInIds.map((id) => this.membership.isMember(wid, id)))
    const members = signedInIds.filter((_, i) => flags[i])
    if (members.length !== 1) {
      throw new HttpError("No unique signed-in account can access this workspace", {
        status: 404, code: "WORKSPACE_NOT_RESOLVABLE",
      })
    }
    return { ownerUserId: members[0] }
  }
  ```
  Active id is enumerated first then alts in slot order; coalesced alts that
  repeat the active id are de-duped; stale alts (`ok:false`) skipped.
  `HttpError`/codes per INV-32 (same pattern as `switch`).

### 2. Backend — handler + route

- `apps/control-plane/src/features/accounts/handlers.ts`: add `resolve`
  mirroring `list`/`switch` (INV-34 thin, INV-55 Zod **query**, INV-32):
  ```ts
  const resolveQuerySchema = z
    .object({ userId: z.string().min(1).optional(), workspaceId: z.string().min(1).optional() })
    .refine((d) => !!d.userId || !!d.workspaceId, { message: "userId or workspaceId required" })
  async resolve(req, res) {
    if (!req.workosUserId || !req.authUser)
      throw new HttpError("Not authenticated", { status: 401, code: "NOT_AUTHENTICATED" })
    const parsed = resolveQuerySchema.safeParse(req.query)
    if (!parsed.success)
      throw new HttpError("Invalid query", { status: 400, code: "VALIDATION_ERROR" })
    res.json(await accountsService.resolve(req.cookies, req.authUser, parsed.data))
  }
  ```
- `apps/control-plane/src/routes.ts`:
  - `:71` → `new AccountsService({ authService, workspaceService })`
    (`workspaceService` already a destructured `deps` member in scope, used
    at `:79`/`:81`).
  - Register in the multi-account group (after `:121`), extend the comment:
    `app.get("/api/accounts/resolve", auth, authLimit, accounts.resolve)`.

### 3. Frontend — resolve API client (workspace form only)

`apps/frontend/src/api/accounts.ts` (**NEW**, mirrors `api/workspaces.ts:40-42`):
```ts
import { api } from "./client"
export const accountsApi = {
  resolve(workspaceId: string): Promise<{ ownerUserId: string }> {
    return api.get(`/api/accounts/resolve?workspaceId=${encodeURIComponent(workspaceId)}`)
  },
}
```
PR-4b's frontend only uses the bare-workspace form (no notification UI).
The identity (`userId`) form is backend-built + tested now but its frontend
caller arrives in PR-6 — adding a `userId` param here with no consumer
would be speculative (INV-36). `api.get` already does `API_BASE` +
`credentials:"include"` + throws `ApiError` on non-2xx.

### 4. Frontend — replace the bounce with resolve→switch

`apps/frontend/src/pages/workspace-layout.tsx` — the `WorkspaceSyncHandler`
terminal-error effect at **`:241-254`** is the documented seam. Extract the
orchestration into a small colocated hook
`useResolveOrBounce(workspaceId, syncEngine)` (keeps the component thin —
INV-15 — and makes it unit-testable without mounting the full SyncEngine):

- Reads `useAccountScope()` for `switchAccount` + `activeWorkosUserId`
  (`workspace-layout` is inside `AccountScopeProvider` per the PR-4a App
  tree — confirmed available).
- On `workspaceSyncStatus === "error"` and `syncEngine.lastWorkspaceError`
  is an `ApiError` with `status` 403/404 (unchanged trigger):
  1. Ref keyed to `workspaceId` so resolve is attempted **at most once per
     workspace error**; `ignore`/cleanup flag drops a late result after
     unmount/workspace-change.
  2. `await accountsApi.resolve(workspaceId)`.
     - `{ ownerUserId }` with `ownerUserId !== activeWorkosUserId` →
       `await switchAccount(ownerUserId)`. Do **not** clear last-workspace,
       do **not** navigate. PR-4a's keyed remount re-bootstraps the same
       `workspaceId` (URL unchanged) under the owning account and succeeds.
       INV-53 satisfied structurally by the remount.
     - `ApiError` (404 — none **or** 2+ ambiguous; backend already enforced
       "unique only", so the frontend needs no count logic), or
       `ownerUserId === activeWorkosUserId` (defensive no-op-switch guard) →
       the **exact current behavior**: guarded `clearLastWorkspaceId()` +
       `navigate("/workspaces", { replace: true })`.
- The "switch only if unique" rule lives **backend-side** (single source of
  truth: returns 404 on 0 or 2+); the frontend stays simple. The bounce
  branch keeps the `getLastWorkspaceId() === workspaceId` guard byte-identical.

No router-config change (React Router v7, no loaders; route stays
`/w/:workspaceId`). No reload anywhere.

### 5. Doc

Append a **PR-4b** section to `docs/plans/multi-account-login-split.md`
(the split doc has no PR-4b section yet): the two-form resolve contract,
the "never substitute on identity form" and "unique-only on bare-link
form" rules, and that PR-6's notification-click is a trivial caller of the
identity form. Match the PR-3 section's terseness.

## Critical files

| File | Change |
|---|---|
| `apps/control-plane/src/features/accounts/service.ts` | add `MembershipChecker` dep + `resolve()` (identity + unique-membership forms); reuse `resolveAlts` |
| `apps/control-plane/src/features/accounts/handlers.ts` | add `resolve` handler (Zod query refine, `HttpError`) |
| `apps/control-plane/src/routes.ts` | inject `workspaceService` into `AccountsService` (`:71`); register `GET /api/accounts/resolve` (after `:121`) |
| `apps/frontend/src/api/accounts.ts` | **NEW** — `accountsApi.resolve(workspaceId)` (workspace form) |
| `apps/frontend/src/pages/workspace-layout.tsx` | replace `:241-254` bounce with `useResolveOrBounce` |
| `apps/control-plane/src/features/accounts/service.test.ts` | **NEW** — both forms incl. the never-substitute case |
| `apps/control-plane/src/features/accounts/handlers.test.ts` | **NEW** — handler tests (mirror `workspaces/handlers.test.ts:1-57`) |
| `apps/frontend/src/pages/use-resolve-or-bounce.test.tsx` | **NEW** — resolve→switch vs bounce |
| `docs/plans/multi-account-login-split.md` | append PR-4b section |

**Reuse (no reimplementation):** `AccountsService.resolveAlts`
(`service.ts:62-71`); `ControlPlaneWorkspaceService.isMember`
(`workspaces/service.ts:69-71`); PR-4a `useAccountScope().switchAccount` +
keyed remount; `api.get`/`ApiError` (`api/client.ts`);
`api/workspaces.ts:40-42` client shape; existing
`clearLastWorkspaceId`/`getLastWorkspaceId` on the bounce path.

## Verification

**First step (explicit user request — rebase on updated `origin/main`):**
PR-4a is squash-merged as `origin/main` `6782e487`; the local branch's
`2142f6a8`+`cc4f799a` are exactly that squashed work. Reset to a clean
PR-4b base:
```
git fetch origin main
git checkout claude/review-multi-account-auth-4eC4g
git reset --hard origin/main      # discards only the pre-squash PR-4a commits, now in main
git log --oneline -1              # expect 6782e487 (PR-4a #540)
git diff origin/main -- apps/frontend/src/auth/account-scope.tsx  # expect empty
```
No work lost (PR-4a content is fully in `6782e487`). Develop/push **only**
to `claude/review-multi-account-auth-4eC4g`.

**Backend tests** (`bun:test`, mirror `workspaces/handlers.test.ts:1-57`
mock-recorder; stub `authService.authenticateSession` per-alt + a
`membership.isMember` mock; INV-23/24 assert content not counts):
- Identity form: `userId` = active → `{ownerUserId: active}`; `userId` =
  parked alt → `{ownerUserId: alt}`.
- **Never-substitute (the case the user raised):** signed into A & B, both
  members of W, ask `userId=C` → 404 `ACCOUNT_NOT_SIGNED_IN`; assert the
  response is **not** A or B.
- Identity + stale membership: `userId` signed in but `isMember(ws,userId)`
  false → 404 `WORKSPACE_NOT_RESOLVABLE`.
- Bare-workspace form: exactly one signed-in member → that id; zero members
  → 404; **2+ members → 404** and response is **neither** id.
- Stale alt (`ok:false`) skipped; coalesced alt duplicating active id
  de-duped (one `isMember` per distinct id, issued in parallel).
- Handler: neither `userId` nor `workspaceId` → 400 `VALIDATION_ERROR`;
  unauthenticated → 401.

**Frontend test** (`use-resolve-or-bounce.test.tsx`, real hook via
`renderHook`; spy `useSyncStatus`/`useAccountScope` per
`coordinated-loading-context.test.tsx`; stub `accountsApi.resolve`; assert
no `window.location` assignment per `account-scope.test.tsx`):
- 403 + resolve `{ownerUserId:"workos_B"}` (≠ active) → `switchAccount("workos_B")`
  called, `navigate` **not** called, last-workspace **not** cleared.
- 403 + resolve rejects `ApiError(404)` (none / ambiguous) →
  `navigate("/workspaces",{replace:true})`, `switchAccount` **not** called,
  guarded `clearLastWorkspaceId` preserved.
- Resolve attempted at most once while status stays `"error"`.

**Commands:** `bun run --cwd apps/control-plane test`,
`bun run --cwd apps/frontend test`, `bun run --cwd apps/control-plane typecheck`,
`bun run --cwd apps/frontend typecheck` — all green incl. new tests. Then
commit + push to `claude/review-multi-account-auth-4eC4g` (do **not** open
a PR unless explicitly asked).

## Risks / accepted trade-offs

- **R1 — Bare workspace deep-link with 2+ signed-in members → 404 (bounce)
  by design.** No arbitrary-account guess; PR-5's switcher disambiguates.
  Single-member links flip seamlessly.
- **R2 — Identity form never substitutes.** A notification for an account
  not signed into this browser → 404 → full login (no silent fallback to a
  different account that can read the workspace). This is the intended
  correctness behavior, not a regression.
- **R3 — switch path is a full keyed-subtree remount** (inherited from
  PR-4a): a brief UI flash on the cross-account deep-link flip. Acceptable
  for this infra slice; PR-5 owns switch UX.
- **R4 — single resolve attempt per workspace error** (ref-guarded).
  Post-remount the fresh mount may resolve again and 404→bounce — terminal,
  not a loop (`ownerUserId===active` guard prevents a self-switch loop).
- **R5 — in-process `isMember`** vs the sketch's internal HTTP route:
  documented in Context; strictly better (source-of-truth, no extra hop).

## Out of scope (later slices)

Switcher UI, `intent=add` "Add account" entry point, account-list
rendering, `MAX_ACCOUNTS` relaxation, logout-all (**PR-5**); cross-account
push + notification-click — a thin caller of this slice's **identity**
resolve form (**PR-6**); backoffice cookie rename (**PR-2**).
