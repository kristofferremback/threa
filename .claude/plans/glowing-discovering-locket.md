# PR-5 — Account Switcher UX (sidebar entry → dialog: switch / add / remove)

## Context

Sixth implementation slice of the multi-account login split
(`docs/plans/multi-account-login-split.md`). Merged to `origin/main`
(HEAD `765d6fb1`): PR-1 (#537 cookie/auth primitives), PR-3 (#538
`/api/accounts` contract + OAuth `intent=add`), PR-4a (#540 AccountScope —
account-scoped data layer + in-place `switchAccount` + keyed remount),
**PR-4b (#542 cross-account entry resolver)**, offline-first (#539).

**The gap PR-5 closes:** every backend primitive for multi-account is
shipped and tested, but there is **no UI**. `GET /api/accounts` (list),
`POST /api/accounts/switch`, `POST /api/accounts/remove`, and the OAuth
`GET /api/auth/login?intent=add` flow (parks the active account, returns
`?accountError=MAX_ACCOUNTS_REACHED` at the cap) all work — verified:
`grep` finds **zero** frontend consumers of `accountError`, `intent=add`,
`accountsApi.list`, or `accountsApi.remove`. A user signed into two
accounts on this browser cannot see, switch between, add, or remove them.

PR-5 adds the **only user-facing surface**: a sidebar-footer menu entry
that opens an account-switcher dialog listing every signed-in account
(active / parked / stale) with switch, add-account, and remove actions.
No new backend code — PR-5 is a pure frontend consumer of contracts that
already exist on `origin/main`.

**Two correctness anchors carried from prior slices:**

1. **Switch is no-reload.** PR-4a's `useAccountScope().switchAccount(id)`
   already does the full flow (POST `/switch` → flush module caches →
   `setSwitchedId` → keyed remount → BroadcastChannel). PR-5 must call
   *that*, never re-implement the fetch and never `window.location`.
2. **`MAX_ACCOUNTS` (4) is load-bearing.** The cookie-size compile-time
   guard (`packages/backend-common/src/cookies.ts:53-79`) has zero
   headroom — bumping to 5 trips it. PR-5 keeps 4 and reads the cap from
   the `list` response (`maxAccounts`), never hardcodes it (INV-33).

## Step 0 — branch reset (mandatory first; non-destructive here)

PR-4b was squash-merged. The local branch's `acc8087e`, `ae9caf72`,
`6782e487` are the **pre-squash** PR-4b/PR-4a commits — their content is
byte-identical to `origin/main` `1cc499cc (#542)` and `6782e487 (#540)`.
Per the standing constraint we develop/push **only** to
`claude/review-multi-account-auth-4eC4g`, so reset that branch onto the
updated main (do **not** create a new branch):

```
git fetch origin main
git checkout claude/review-multi-account-auth-4eC4g
git reset --hard origin/main          # discards only superseded pre-squash commits
git log --oneline -1                   # expect 765d6fb1 (#545)
git status --porcelain                 # expect empty (clean tree already confirmed)
```

No work lost — PR-4b is fully in `origin/main`. All PR-5 commits/pushes go
to `claude/review-multi-account-auth-4eC4g`. Do **not** open a PR unless
explicitly asked.

## Approach

### 1. API client — add `list` + `remove` (`switch` stays in PR-4a)

`apps/frontend/src/api/accounts.ts` (extend; alongside existing `resolve`):

```ts
export interface AccountSummary {
  id: string
  email: string
  name: string
  state: "active" | "parked" | "stale"
}

export const accountsApi = {
  resolve(workspaceId: string) { /* unchanged */ },
  list(): Promise<{ accounts: AccountSummary[]; maxAccounts: number }> {
    return api.get("/api/accounts")
  },
  remove(targetUserId: string): Promise<{ removedId: string }> {
    return api.post("/api/accounts/remove", { targetUserId })
  },
}
```

- `apps/frontend/src/api/index.ts`: change the existing line to
  `export { accountsApi, type AccountSummary } from "./accounts"`.
- **Do NOT add `switch` here.** PR-4a owns the switch path inside
  `account-scope.tsx` (raw fetch + cache flush + remount + broadcast);
  duplicating it as an api-client method forks the contract
  (INV-35/37/49). PR-5 calls `useAccountScope().switchAccount`.
- `AccountSummary` is declared frontend-local: control-plane's interface
  is in `apps/control-plane/src/features/accounts/service.ts:25-30`, not
  in a shared `@threa/types` package, so the frontend mirrors the shape
  (accepted duplication — R1). `api.get`/`api.post` already do
  `API_BASE` + `credentials:"include"` + `ApiError` on non-2xx.

### 2. Auth — thread `intent=add` + surface `accountError`

`apps/frontend/src/auth/context.tsx`:

- Widen `login` in `AuthContextValue` and the `useCallback`:
  `login: (redirectTo?: string, opts?: { intent?: "add" }) => void`.
  When `opts?.intent === "add"`, append `intent=add` to the built URL
  (alongside the existing optional `redirect_to`). The only existing
  caller is `login.tsx:24` (`login()` — no args), unaffected (R2).
- In `AuthProvider` (sits **above** the router — must use
  `window.location`, not `useSearchParams`): on mount, if
  `window.location.search` contains `accountError=MAX_ACCOUNTS_REACHED`,
  fire `toast.error(...)` (sonner — app-wide) and strip the param via
  `window.history.replaceState` so a refresh doesn't re-toast (R3). No
  existing consumer — net new, no migration.

### 3. New component — `AccountSwitcherDialog`

`apps/frontend/src/components/account-switcher/account-switcher-dialog.tsx`
(+ `index.ts` barrel). **Mirror `WorkspaceSettingsDialog`**
(`apps/frontend/src/components/workspace-settings/workspace-settings-dialog.tsx`)
for wiring:

- `useSearchParams()`; param key `account-switcher`; `mounted` guard
  (`useState`+`useEffect`, `if (!mounted) return null`); `isOpen = param
  !== null`; `close()` deletes the param with `setSearchParams(_, {
  replace: true })`. **Direct `setSearchParams`, no React context** — URL
  is the single source of truth (INV-59); matches the workspace-settings
  precedent (not the SettingsDialog context pattern).
- `ResponsiveDialog`/`ResponsiveDialogContent`/`…Header`/`…Title`/`…Description`
  (INV-14 — desktop dialog / mobile drawer automatically).
- Data: TanStack `useQuery({ queryKey: ["accounts","list"], queryFn: () =>
  accountsApi.list(), enabled: isOpen })`. `useAccountScope()` for
  `switchAccount` + `activeWorkosUserId`; `useAuth()` for `login`;
  `useQueryClient()` to invalidate `["accounts","list"]` after a remove.
- **Module-scope** `AccountRow` sub-component (INV-18 — never define a
  component inside another), branching on `account.state`:
  - `active`: avatar + name/email + a non-interactive check / "This
    account" label. No action.
  - `parked`: row is a `<button>` → `await scope.switchAccount(id)`.
    PR-4a's keyed remount unmounts this dialog with the per-account
    subtree, so no explicit close needed (R4). Errors bubble to the
    caller's `try/catch` → `toast.error`.
  - `stale`: placeholder ("Signed-out account", no email) + two
    affordances — **"Sign in again"** → `login(undefined, { intent:
    "add" })`; **"Remove"** → `accountsApi.remove(account.id)` (the
    verbatim `stale:alt_<slot>` id — backend `STALE_ID_RE` parses it)
    then `invalidateQueries(["accounts","list"])`.
  - Each non-active **parked** row also gets a secondary "Remove" →
    `accountsApi.remove(id)` + invalidate.
  - Footer "Add account" button (shown only while
    `accounts.length < maxAccounts`) → `login(undefined, { intent:
    "add" })`. Cap read from `maxAccounts`, never hardcoded (INV-33);
    backend still enforces it server-side regardless.
  - Active-account removal (logout-of-this-account with next-account
    promotion) is **out of scope** — the existing footer "Log out" stays
    the all-accounts logout. Remove is offered on parked + stale only.
- All actions mutate session state → `<button>` (INV-40). "Add account" /
  "Sign in again" trigger an OAuth redirect via `login` (programmatic
  navigation that must run cleanup) — buttons, consistent with the
  existing `login.tsx` button.

### 4. Sidebar entry point

`apps/frontend/src/components/layout/sidebar/sidebar-footer.tsx`:

- Add an `openAccountSwitcher` `useCallback` mirroring the existing
  `openWorkspaceSettings` (`:84-94`): `collapseOnMobile()` then
  `setSearchParams` setting `account-switcher`.
- Add a `menuActions` entry (`SidebarActionItem` —
  `sidebar-actions.tsx:19-27`) **above "Log out"**:
  `{ id: "switch-account", label: "Switch account", icon: <Users>,
  onSelect: openAccountSwitcher, separatorBefore: true }`, and adjust
  logout's `separatorBefore` so divider grouping stays clean. Add
  `openAccountSwitcher` to the `useMemo` deps (`:133`).
  `runSidebarAction` already wraps `onSelect` in try/catch + `toast.error`.

### 5. Mount the dialog

`apps/frontend/src/pages/workspace-layout.tsx`: add
`<AccountSwitcherDialog />` to the always-mounted dialog cluster
immediately after `<WorkspaceSettingsDialog workspaceId={workspaceId} />`
(`:385`). No props — account switching is workspace-agnostic; the dialog
reads the URL param itself like the other dialogs there.

### 6. Doc

`docs/plans/multi-account-login-split.md`, PR-5 section: record the
switcher contract (sidebar entry → `?account-switcher` dialog; list via
`GET /api/accounts`; switch via PR-4a `switchAccount`; remove via
`POST /api/accounts/remove` incl. verbatim `stale:alt_<slot>`;
add / sign-in-again via `login(intent:"add")`; cap surfaced from
`maxAccounts` + `accountError` toast), and one line that **MAX_ACCOUNTS
stays 4** (cookie-size guard `cookies.ts:53-79` load-bearing — no bump in
this slice). Match the PR-3 / PR-4b sections' terseness.

## Critical files

| File | Change |
|---|---|
| `apps/frontend/src/api/accounts.ts` | add `AccountSummary` type + `list()` + `remove()` |
| `apps/frontend/src/api/index.ts` | re-export `accountsApi`, `type AccountSummary` |
| `apps/frontend/src/auth/context.tsx` | `login(redirectTo?, {intent?})`; `accountError` toast (window.location + history.replaceState) |
| `apps/frontend/src/components/account-switcher/account-switcher-dialog.tsx` | **NEW** — ResponsiveDialog, `?account-switcher`, useQuery list, module-scope `AccountRow` per state |
| `apps/frontend/src/components/account-switcher/index.ts` | **NEW** — barrel |
| `apps/frontend/src/components/layout/sidebar/sidebar-footer.tsx` | `openAccountSwitcher` + "Switch account" menu entry |
| `apps/frontend/src/pages/workspace-layout.tsx` | mount `<AccountSwitcherDialog />` after `:385` |
| `apps/frontend/src/components/account-switcher/account-switcher-dialog.test.tsx` | **NEW** — render real component, states + actions |
| `apps/frontend/src/auth/context.test.tsx` | extend — `intent=add` URL + `accountError` toast/strip |
| `apps/control-plane/src/features/accounts/*.test.ts` | add a `remove("stale:alt_<slot>")` case if not already covered |
| `docs/plans/multi-account-login-split.md` | append PR-5 section |

**Reuse (no reimplementation):** PR-4a `useAccountScope().switchAccount` +
keyed remount; `api.get`/`api.post`/`ApiError` (`api/client.ts`);
`ResponsiveDialog` (INV-14); `WorkspaceSettingsDialog` URL-param dialog
pattern (`?ws-settings`, `mounted` guard, `{replace:true}` close);
`SidebarActionItem` + `runSidebarAction` (`sidebar-actions.tsx`) and the
existing `openWorkspaceSettings` callback shape; backend `list` / `remove`
/ `addAndParkActive` / `accountError` (all on `origin/main`); sonner
`toast`.

## Verification

**Tests** (test-first per CLAUDE.md; INV-22/23/24/39/48):

- `account-switcher-dialog.test.tsx` (mount the real component with a
  `QueryClient` + `MemoryRouter`; `spyOn` namespace imports for
  `accountsApi.list/remove` and `useAccountScope().switchAccount`; assert
  observable behavior, **never** event counts; **no `window.location`**
  assignment assertion, mirroring `account-scope.test.tsx`):
  - list with active+parked+stale → all three rows render with the right
    affordances.
  - click a parked row → `switchAccount(parkedId)` called.
  - "Remove" on a stale row → `accountsApi.remove("stale:alt_1")` then a
    refetch of `["accounts","list"]`.
  - "Add account" / "Sign in again" → `login(undefined,{intent:"add"})`.
  - `?account-switcher` absent → renders nothing.
- `auth/context.test.tsx`: `login(undefined,{intent:"add"})` sets
  `window.location.href` containing `intent=add`;
  `?accountError=MAX_ACCOUNTS_REACHED` on load → `toast.error` fired and
  the param removed via `history.replaceState`.
- Control-plane: confirm the accounts suite covers `remove` of a
  `stale:alt_<slot>` id (clears slot, returns `{removedId}`); add the
  case if absent. No new backend production code in PR-5.

**Commands (all green incl. new tests):**

```
bun run --cwd apps/frontend test
bun run --cwd apps/control-plane test
bun run --cwd apps/frontend typecheck
bun run --cwd apps/control-plane typecheck
```

**Manual UI smoke (CLAUDE.md frontend rule):** dev server → sidebar
footer menu → "Switch account" opens the dialog (URL gains
`?account-switcher`); a parked row flips accounts **without a page
reload** and re-bootstraps; "Add account" redirects to
`/api/auth/login?intent=add`; hitting the cap returns
`?accountError=MAX_ACCOUNTS_REACHED` → toast + param stripped; "Remove"
on a parked/stale row drops it from the list. Then commit + push to
`claude/review-multi-account-auth-4eC4g` (backoff retry on network
error). Do **not** open a PR unless explicitly asked.

## Risks / accepted trade-offs

- **R1 — `AccountSummary` duplicated frontend-side.** No shared
  control-plane↔frontend types package for this contract; the shape is
  small and stable. Moving it to `@threa/types` is a larger refactor, out
  of scope (INV-36).
- **R2 — `login` signature widened.** Optional trailing arg; the sole
  existing caller (`login.tsx:24`) passes nothing — no churn.
- **R3 — `accountError` handled above the router.** `AuthProvider` can't
  use `useSearchParams`; reading `window.location.search` + stripping via
  `history.replaceState` is the correct seam and prevents a re-toast on
  refresh.
- **R4 — switch = full keyed-subtree remount** (inherited from PR-4a):
  brief flash; the dialog unmounts with the subtree, so close-on-success
  is implicit (no extra close call, no race).
- **R5 — `MAX_ACCOUNTS` cookie-size guard is load-bearing.** PR-5 keeps
  it at 4 and surfaces the cap from the `list` response, never hardcoded.
- **R6 — Step 0 `git reset --hard`** discards local commits; safe only
  because they are byte-identical to merged `1cc499cc (#542)` /
  `6782e487 (#540)` — verify via `git log` before reset; clean tree
  confirmed (`git status --porcelain` empty).

## Out of scope (later slices)

PR-6 cross-account push + notification-click (thin caller of PR-4b's
identity `resolve` form); PR-2 backoffice cookie rename; extracting
`switch` into the api client; any `MAX_ACCOUNTS` bump; active-account
"remove" / next-account-promotion UX (the existing footer "Log out"
remains the all-accounts logout).
