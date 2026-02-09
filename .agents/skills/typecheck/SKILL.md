---
name: typecheck
description: Run TypeScript type checking across the entire monorepo
allowed-tools: Bash(bun run typecheck:*), Bash(bun run --cwd:*)
---

# Typecheck

Runs TypeScript type checking across the entire monorepo. Reports errors with file locations and suggests fixes.

## Instructions

### Step 1: Run Typecheck

Run the root typecheck command which checks all workspaces in dependency order:

```bash
bun run typecheck 2>&1
```

This runs `tsc --noEmit` across:

1. `packages/types` — shared domain types (no dependencies)
2. `packages/prosemirror` — editor state wrapper (depends on types)
3. `apps/backend` — Express API + Workers + Evals (depends on types, prosemirror)
4. `apps/frontend` — React app (depends on types)

### Step 2: Report Results

**If all workspaces pass (exit code 0):**

```
Typecheck passed — all 4 workspaces clean.
```

**If errors are found (exit code non-zero):**

1. Parse errors from the output. TypeScript errors follow the format:
   `path/file.ts(line,col): error TSXXXX: message`

2. Group errors by workspace and file

3. For each error, read the relevant file around the error line to understand context

4. Report errors grouped by workspace:

```
Typecheck found N errors in M files:

**packages/types** (0 errors)
**packages/prosemirror** (0 errors)
**apps/backend** (X errors)
  - `src/path/file.ts:42` — TS2345: description + suggested fix
  - `evals/path/file.ts:10` — TS6133: description + suggested fix

**apps/frontend** (Y errors)
  - `src/path/file.ts:100` — TS2322: description + suggested fix
```

5. If the user wants fixes, apply them. Common patterns:
   - **TS6133 (unused variable)**: Remove the variable or prefix with `_` (only in backend — frontend has `noUnusedLocals: true` which doesn't respect `_` prefix)
   - **TS2345 (type mismatch)**: Check if a type changed upstream and update the usage
   - **TS2307 (cannot find module)**: Check if a file was moved and update the import path
   - **TS2322 (type not assignable)**: Check if a constant/enum value changed

### Step 3: Targeted Workspace Check (Optional)

If the user specifies a workspace, run only that one:

```bash
bun run --cwd packages/types typecheck 2>&1
bun run --cwd packages/prosemirror typecheck 2>&1
bun run --cwd apps/backend typecheck 2>&1
bun run --cwd apps/frontend typecheck 2>&1
```

## Notes

- Backend tsconfig includes `src/**/*` and `evals/**/*` — both application code and eval suites are type-checked
- The workspaces run sequentially because they have dependency relationships
- Frontend has `noUnusedLocals: true` and `noUnusedParameters: true` — stricter than backend

## Example Usage

```
/typecheck
/typecheck backend
/typecheck frontend
```
