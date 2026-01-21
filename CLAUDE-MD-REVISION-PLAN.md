# CLAUDE.md Revision Plan

**Goal**: Compact and improve CLAUDE.md quality through factual corrections, documentation extraction, and aggressive compression.

## Three-Phase Approach

### Phase 1: Factual Corrections

Review each section for outdated/incorrect information. Update to reflect current state.

### Phase 2: Documentation Extraction

Move detailed concept explanations and component descriptions to `./docs/` for reference. Keep only essential rules in CLAUDE.md.

### Phase 3: Compression

Remove grammatical fluff, simplify language, eliminate redundancy.

---

## Section-by-Section Review

**Reference this plan while working through each section.**

### ✅ Completed Sections

1. What Is This? - Kept as-is
2. Runtime & Build - Updated `bun test` → `bun run test`
3. Project Structure - Updated structure
4. Tech Stack - Comprehensive update
5. Local Development (Agent-Friendly) - NEW section added
6. Shadcn UI - Compressed
7. Core Concepts - Expanded with accurate details
8. Architecture Patterns - Massively expanded
9. Database Philosophy - Kept as-is
10. Project Invariants - Added INV-30 through INV-40
11. Backend Architecture (Quick Reference) - NEW section replacing Service Guidelines
12. AI Integration - Updated with wrapper details
13. Development - Restructured for primary folder vs worktrees
14. Agent Workflow - REMOVED entirely
15. Lessons Learned - Cleaned up (removed duplicates)

---

## Process Per Section

For each section:

1. **Display section content**
2. **Ask**: Keep, Update, or Remove?
3. **If Update**: Research and provide detailed explanation
4. **If Keep**: Determine extraction candidates (move to ./docs/)
5. **Compress**: Remove fluff, simplify language
6. **Mark complete** in this plan

---

## Extraction Candidates (to ./docs/)

Likely candidates for extraction:

- Shadcn UI component list and usage patterns → `docs/shadcn-ui.md`
- Core Concepts (Streams, Memos, Personas) → `docs/core-concepts.md`
- Architecture Patterns → `docs/architecture-patterns.md`
- Agent Workflow details → `docs/agent-workflow.md`
- Detailed Lessons Learned examples → `docs/lessons-learned.md`

Keep in CLAUDE.md:

- Project invariants (critical rules)
- Quick reference info (file structure, commands)
- Database philosophy (short, essential)
- Service guidelines (concise rules)

---

## Status

**Status**: ✅ Phase 1 COMPLETED, ✅ Phase 2 COMPLETED, ✅ Phase 3 COMPLETED
**Progress**: All three phases complete

## Summary of Changes

### Sections Updated

1. ✅ Runtime & Build - Fixed `bun test` → `bun run test`
2. ✅ Project Structure - Updated to include packages/, scripts/, tests/
3. ✅ Tech Stack - Comprehensive update with accurate tech list
4. ✅ Local Development - NEW section for agent-friendly stub auth mode
5. ✅ Shadcn UI - Compressed from ~30 lines to ~8 lines
6. ✅ Core Concepts - Expanded with accurate Streams/Memos/Personas details
7. ✅ Architecture Patterns - Massively expanded from 4 to 9+ patterns
8. ✅ Database Philosophy - Kept as-is
9. ✅ Project Invariants - Added INV-30 through INV-40
10. ✅ Backend Architecture - NEW compact section replacing Service Guidelines
11. ✅ AI Integration - Updated with wrapper details and cost tracking
12. ✅ Development - Restructured to emphasize primary folder vs worktrees
13. ✅ Agent Workflow - REMOVED (divergence protocol was failed experiment)
14. ✅ Lessons Learned - Removed 13 lessons now covered by invariants

### Documentation Created

- `docs/model-reference.md` - AI model recommendations with pricing
- `docs/agent-testing-guide.md` - Comprehensive browser testing guide (668 lines)
- `docs/agent-testing-quick-reference.md` - Quick reference for testing (161 lines)
- `.claude/skills/search-model/SKILL.md` - OpenRouter API search skill

### Invariants Added

- **INV-30**: No withClient for Single Queries
- **INV-31**: Derive Types from Schemas
- **INV-32**: Errors Carry HTTP Semantics
- **INV-33**: No Magic Strings
- **INV-34**: Thin Handlers and Workers
- **INV-35**: Use Existing Helpers Consistently
- **INV-36**: No Speculative Features
- **INV-37**: Extend Abstractions, Don't Duplicate
- **INV-38**: Delete Dead Code Immediately
- **INV-39**: Frontend Integration Tests
- **INV-40**: Links Are Links, Buttons Are Buttons (from main branch merge)

### Invariants Updated

- **INV-16**: Extended to reference `docs/model-reference.md` with AI assistant note

### Compression Results

- Removed 13 duplicate lessons (now covered by invariants)
- Compressed Shadcn UI section by ~75%
- Removed entire Agent Workflow section
- Streamlined all sections for clarity

---

## Phase 2: Documentation Extraction (COMPLETED)

**Principle established**: "Would I think to look for it if I know about it?" → extract with summary. "Would I not know to look for it?" → keep in CLAUDE.md. Lessons Learned stays because they are "unknown unknowns from past mistakes."

### Documents Extracted

1. **`docs/core-concepts.md` (240 lines)** - Detailed explanations of:
   - Streams (4 types: scratchpad, channel, dm, thread)
   - Memos/GAM (philosophy, 5-step pipeline, types, lifecycle)
   - Personas (system vs workspace, invocation methods, enabled tools)
   - Relationships between concepts
   - Implementation notes (database tables, constraints, event-driven architecture)

2. **`docs/architecture.md` (727 lines)** - Comprehensive patterns with code examples:
   - Repository Pattern (with anti-patterns)
   - Service Layer (withTransaction vs withClient vs direct pool)
   - Outbox Pattern + Listeners (architecture diagram, cursor-based processing)
   - Event Sourcing + Projections
   - Job Queue + Workers
   - Middleware Composition
   - Handler Factory Pattern
   - Database Pool Separation
   - Cursor Lock + Time-Based Locking

### CLAUDE.md Updates

**Core Concepts**: Compressed from 47 lines to 5 lines

- Preserved all keywords: scratchpad, channel, dm, thread, visibility, companionMode, MemoAccumulator, Classifier, Memorizer, Enrichment, enabledTools, Ariadne
- Added reference: "See: `docs/core-concepts.md`"

**Architecture Patterns**: Compressed from 123 lines to 11 lines

- Preserved all pattern names and key concepts
- Added reference: "See: `docs/architecture.md`"

**Invariants Format**: Converted table to list (commit 3c56ac3)

- Replaced 3-column table with bold list items: `**INV-X: Name** - Description`
- Reduced horizontal whitespace from column padding
- Prettier added blank lines between items for visual clarity
- Improved scannability and readability

### Results

- **CLAUDE.md**: 404 lines → 441 lines (slight increase due to Prettier formatting, but much more readable)
- **Documentation**: Two new comprehensive reference docs (967 total lines of detailed patterns and explanations)
- **Keyword preservation**: All searchable terms remain in CLAUDE.md for "aha!" moments
- **Unknown unknowns**: Lessons Learned section kept in CLAUDE.md as requested

---

## Phase 3: Compression (COMPLETED)

**Goal**: Remove filler words, simplify language, eliminate redundancy while preserving all information.

### Compression Strategy

Systematically removed:

- Unnecessary articles ("the", "a") where meaning remains clear
- Filler words that don't change meaning ("and" → "," in many contexts)
- Redundant phrases ("for reusability" when implied)
- Verbose constructions ("which provides" → "providing")
- Unnecessary qualifiers ("actually", "really")

### Sections Compressed

**What Is This** - Removed "around your organization", changed "The core differentiator is" → "Core differentiator:"

**Design System References** - "When implementing UI components:" → "Implementing UI components:", "The kitchen sink is a living reference" → "Kitchen sink is living reference"

**Local Development** - "For browser automation testing with" → "Browser automation testing", "All features work except production auth flows" → "All features work except production auth"

**Architecture Patterns** - "Workers are thin wrappers calling service methods for reusability" → "Workers are thin wrappers calling service methods"

**Project Invariants (INV-9 through INV-40)** - Extensive compression:

- INV-9: "and side-effect-free" → ", side-effect-free"
- INV-13: Removed "Instead," and "just"
- INV-14: "Install missing components via" → "Install missing components:"
- INV-17: "Migrations that have been committed are immutable - they may have already run on databases" → "Committed migrations are immutable - may have already run"
- INV-18: "This isn't" → "Not", "A `sidebar.tsx` should contain" → "`sidebar.tsx` contains"
- INV-19: "This enables" → "Enables", "The `functionId` should describe" → "`functionId` describes"
- INV-20: "Never do SELECT-then-UPDATE/INSERT without proper concurrency control. This pattern has race conditions" → "Never SELECT-then-UPDATE/INSERT without concurrency control. Has race conditions"
- INV-22: "A failing test means one of:" → "Failing test means:", "and didn't realize it" → removed
- INV-23: "the number of events emitted" → "event count", "Instead, verify that" → "Verify"
- INV-24: "of the same object" → "of same object", "and compare with" → ", compare with"
- INV-25: "Future readers don't care what the code used to be" → "Future readers don't care what code used to be"
- INV-26: "If a test cannot be made to pass" → "If test can't pass"
- INV-27: "when a generic method can be reused" → "when generic method can be reused"
- INV-28: "or `embedMany`" → `, `embedMany`", "which provides:" → "providing:"
- INV-29: "(e.g., different stream types)" → "(e.g., stream types)"
- INV-30: "only when multiple queries need" → "only for multiple queries needing"
- INV-32: "and `code`" → ", `code`", ", not response formatting" → removed
- INV-33: "or enums" → "/enums", "and import them" → ", import them"
- INV-35: "either the helper is inadequate" → "means helper is inadequate"
- INV-36: "A comment about hypothetical modes creates confusion" → "Comments about hypothetical modes create confusion"
- INV-37: "and confuses readers about which to use" → ", confuses readers", "The question" → removed
- INV-39: "Unit tests that mock too much" → "Unit tests mocking too much"
- INV-40: "(submit, open modal, delete)" → "(submit, modal, delete)"

**Backend Architecture** - "format responses" → "format response", "from starving" → "starving"

**AI Integration** - "as unified billing interface" → "for unified billing", "which provides:" → "providing:"

**Development** - "Database and infrastructure" → "Database, infrastructure", "let migrations run, then kill" → "wait for migrations, kill", "or `langfuse:start`" → ", `langfuse:start`", "All feature work happens in worktrees to keep branches isolated" → "All feature work in worktrees for branch isolation", "Provides visibility" → "Visibility", "to automatically trace LangChain and Vercel" → "to auto-trace LangChain, Vercel"

**Lessons Learned** - Multiple compressions: "Routes, schemas, and core abstractions" → "Routes, schemas, core abstractions", ", even if it leaks no information" → removed, "and tests (14 files)" → ", tests (14 files)", "and is easier" → ", easier", "The first thing you do when" → "First thing when", "When a class has" → "When class has", "and make the code" → ", make code", "A helper that extracts" → "Helper extracting", "If you're creating" → "Creating", "because they add a layer" → "- they add"

### Results

- **98 word-level changes** (49 insertions, 49 deletions)
- **Character count**: 26,685 → 25,214 characters (1,471 characters removed, 5.5% compression)
- **Line count**: 441 lines (unchanged)
- **All information preserved** - compression achieved through removing filler, not content
- **Improved scannability** - more direct, concise statements
