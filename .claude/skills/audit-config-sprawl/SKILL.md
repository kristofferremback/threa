---
name: audit-config-sprawl
description: Find configuration sprawl - duplicated constants, types, and values that should be centralized
---

# Audit Configuration Sprawl

Find and report configuration sprawl across the codebase. Configuration sprawl occurs when the same value, constant, type, or configuration is defined in multiple places instead of being imported from a single source of truth.

## Why This Matters

Configuration sprawl leads to:

- **Drift**: Values get out of sync when one copy is updated but others aren't
- **Confusion**: Unclear which definition is canonical
- **Fragility**: Refactoring becomes error-prone
- **Bugs**: Inconsistent values cause subtle failures

## The Core Principle

**Every piece of configuration should have exactly one canonical source.** Consumers import from that source. If you find the same thing defined twice, one of them shouldn't exist.

## Instructions

### Phase 1: Understand the Codebase Structure

Before searching for sprawl, understand where configuration SHOULD live:

1. **Check for a shared types package** (e.g., `packages/types`, `@company/types`)
   - What constants and types are already centralized?
   - What's the export structure?

2. **Check for config files** in feature directories
   - Look for `config.ts` files
   - What patterns exist for co-locating config with features?

3. **Review CLAUDE.md or similar** for documented conventions
   - Are there invariants about where config should live?
   - What's the expected pattern for new configuration?

### Phase 2: Search for Sprawl Patterns

Look for these general categories. The specific items will vary by codebase.

#### Pattern 1: Constants Defined Multiple Times

Search for the same constant value appearing in multiple files:

```
- String literals that look like configuration
- Numeric values that appear repeatedly (temperatures, timeouts, limits)
- Arrays/enums that define valid values for something
```

**Red flag**: Same string/number appears in 3+ files, or a local `const SOMETHING =` when a shared package exports it.

#### Pattern 2: Types Declared Multiple Times

Search for type definitions that appear in multiple places:

```
- interface SomeName { ... } in multiple files
- type SomeName = ... in multiple files
- Types that exist in a shared package but are redeclared locally
```

**Red flag**: `grep -r "interface TypeName"` returns multiple files.

#### Pattern 3: Magic Strings Instead of Constants

Search for string literals used as discriminators or configuration:

```
- Status values: "active", "pending", "failed"
- Type discriminators: "user", "admin", "system"
- Mode flags: "on", "off", "auto"
- Feature identifiers in conditionals
```

**Red flag**: Same string literal appears in multiple files without a shared constant.

#### Pattern 4: Re-exports Creating Indirection

Search for exports that just re-export from somewhere else:

```
- export { X } from "./other-file"
- export type { X } from "./other-file"
```

**Red flag**: Consumers import from A, which re-exports from B. Why not import from B directly?

#### Pattern 5: Eval/Test Config Diverging from Production

Search for configuration in test/eval directories that duplicates production config:

```
- Model IDs hardcoded in tests instead of imported from production config
- Prompts/schemas copied into test fixtures
- Constants redefined for "testing purposes"
```

**Red flag**: Test and production use different values for the same concept.

### Phase 3: Verify Each Finding

For each potential sprawl issue:

1. **Confirm it's actually duplication** - sometimes similar-looking things serve different purposes
2. **Identify the canonical source** - where SHOULD this be defined?
3. **Check consumers** - how many places would need updating?
4. **Assess severity** - can this cause bugs, or is it just messy?

### Phase 4: Report Findings

For each finding, report:

```
## [SEVERITY] [Brief title]

**Issue**: [What's duplicated and why it's a problem]

**Files**:
- `path/to/file1.ts:line` - [what it defines]
- `path/to/file2.ts:line` - [what it defines]

**Canonical source**: [Where this should live]

**Fix**:
1. [Step to centralize]
2. [Step to update consumers]
```

### Severity Guide

- **HIGH**: Can cause bugs (values could drift, types could mismatch)
- **MEDIUM**: Reduces maintainability (harder to refactor, unclear source of truth)
- **LOW**: Code smell (indirection, unnecessary complexity)

## Example Searches

These are examples of grep/glob patterns to find sprawl. Adapt to your codebase:

```bash
# Find potential constant duplication
grep -r "const.*TYPES\s*=" --include="*.ts"
grep -r "export const.*=.*\[" --include="*.ts"

# Find potential type duplication
grep -r "^export interface" --include="*.ts" | sort | uniq -d
grep -r "^export type" --include="*.ts" | sort | uniq -d

# Find magic strings (common patterns)
grep -rE '"(active|pending|failed|enabled|disabled)"' --include="*.ts"
grep -rE 'status\s*===?\s*"' --include="*.ts"

# Find re-exports
grep -r "export.*from\s*['\"]\./" --include="*.ts"

# Find hardcoded model IDs (AI projects)
grep -rE '"[a-z]+:[a-z]+/[a-z]' --include="*.ts"

# Find hardcoded numbers that look like config
grep -rE "temperature:\s*0\.[0-9]" --include="*.ts"
```

## After the Audit

1. **Prioritize** by severity and number of consumers affected
2. **Group** related fixes into logical commits
3. **Update shared package first** if adding new constants
4. **Update consumers** to import from canonical source
5. **Delete duplicates** - don't leave them commented out
6. **Verify** with type checker and tests after each change

## Tips

- Use parallel searches to minimize audit time
- Start with the shared types package to understand what's already centralized
- Cross-reference findings with existing config files
- Some apparent duplication is intentional (e.g., test-specific values) - verify before reporting
- Focus on sprawl that can cause bugs, not just aesthetic issues
