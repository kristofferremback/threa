---
name: audit-config-sprawl
description: Find configuration sprawl - duplicated constants, types, model IDs, and magic strings that should be centralized
---

# Audit Configuration Sprawl

Find and report configuration sprawl issues across the codebase. Configuration sprawl occurs when constants, types, model IDs, temperatures, or other configuration values are defined in multiple places instead of being imported from a single source of truth.

## Why This Matters

Configuration sprawl leads to:

- Values drifting apart when one copy is updated but others aren't
- Confusion about which definition is canonical
- Harder refactoring when config needs to change
- Bugs from inconsistent values

## Instructions

Run parallel searches to find different types of sprawl. Use haiku models for efficiency since these are pattern-matching tasks.

### 1. Find Duplicate Model IDs

Search for hardcoded AI model strings that should be in config files:

```
Grep for patterns like:
- "openrouter:anthropic/claude"
- "openrouter:openai/gpt"
- Model ID patterns in string literals

Check if each model ID:
- Is defined in a config.ts file (good)
- Is imported from that config file where used (good)
- Is hardcoded in multiple places (sprawl!)
```

### 2. Find Duplicate Domain Constants

Search for constants that should be imported from @threa/types:

```
Look for local definitions of:
- STREAM_TYPES, StreamType
- EVENT_TYPES, EventType
- COMMAND_EVENT_TYPES
- VISIBILITY_OPTIONS
- COMPANION_MODES
- Any other constants from @threa/types/constants.ts

These should ALWAYS be imported from @threa/types, never redeclared.
```

### 3. Find Duplicate Type Definitions

Search for types defined in multiple files:

```
Look for:
- "interface TypeName {" appearing in multiple files
- "type TypeName =" appearing in multiple files
- Types that exist in @threa/types but are redeclared locally

Common culprits:
- SourceItem, AttachmentSummary
- StreamType, EventType
- Any domain entity types
```

### 4. Find Hardcoded Temperatures

Search for numeric temperature values:

```
Look for:
- temperature: 0.X (hardcoded in function calls)
- Temperature constants defined in multiple files

Should be:
- Defined in component's config.ts
- Imported where needed
```

### 5. Find Duplicate System Prompts

Search for system prompt strings:

```
Look for:
- Long strings that look like prompts
- "You are" patterns in code
- Prompt templates defined in multiple files

Should be:
- Defined in component's config.ts
- Shared via ConfigResolver
```

### 6. Find Magic Strings

Search for string literals used as configuration:

```
Look for:
- Status values: "on", "off", "pending", "active"
- Type discriminators: "user", "persona", "web", "workspace"
- Feature flags or mode strings

Should be:
- Defined as const arrays with derived types
- Imported from constants file
```

### 7. Find Re-exports (Anti-pattern)

Search for type re-exports that violate direct import principle:

```
Look for:
- export type { X } from "./other-file"
- export { X } from "./other-file" (re-exporting from local files)

These create indirection. Consumers should import directly from source:
- @threa/types for domain types
- Component's config.ts for component-specific config
```

## Report Format

For each finding, report:

```
SEVERITY: HIGH | MEDIUM | LOW

ISSUE: [Brief description]

FILES:
- file1.ts:line (defines X)
- file2.ts:line (redefines X)

FIX: [What should be done]
- Define X in [canonical location]
- Import from [canonical location] in all consumers
```

### Severity Guide

- **HIGH**: Domain types or constants that exist in @threa/types but are redeclared
- **HIGH**: Config values that could drift and cause bugs (model IDs, prompts)
- **MEDIUM**: Magic strings that reduce type safety
- **LOW**: Re-exports that add indirection but don't cause bugs

## Example Findings

### HIGH: EventType Redeclared

```
ISSUE: EventType union type defined locally instead of imported from @threa/types

FILES:
- stream-event-repository.ts:17 (defines EventType union)
- @threa/types/constants.ts:44 (canonical definition)

FIX:
- Remove local EventType definition
- Import from @threa/types: import { type EventType } from "@threa/types"
```

### MEDIUM: Magic Strings for Source Type

```
ISSUE: Source type discriminator used as magic string

FILES:
- companion-graph.ts:148 (type: "workspace")
- researcher.ts:42 (type: "web")
- send-message-tool.ts:15 (type?: "web" | "workspace")

FIX:
- Add SOURCE_TYPES to @threa/types/constants.ts
- Import and use SourceType where needed
```

## After Running Audit

1. **Prioritize fixes** by severity and blast radius
2. **Group related fixes** into logical commits
3. **Update @threa/types** first if adding new constants
4. **Update consumers** to import from canonical source
5. **Remove duplicates** and re-exports
6. **Run type checker** after each change
7. **Run tests** to verify no regressions

## Common Canonical Locations

| Type of Config           | Canonical Location  |
| ------------------------ | ------------------- |
| Domain types/constants   | @threa/types        |
| Component model IDs      | src/\*/config.ts    |
| Component temperatures   | src/\*/config.ts    |
| System prompts           | src/\*/config.ts    |
| Feature-specific schemas | src/\*/config.ts    |
| API contract types       | @threa/types/api.ts |

## Tips

1. Use the Explore agent with "very thorough" for comprehensive searches
2. Run searches in parallel to minimize time
3. Cross-reference with @threa/types/index.ts exports
4. Check config.ts files for existing centralized definitions
5. Consider INV-44 (AI Config Co-location) when adding new config
