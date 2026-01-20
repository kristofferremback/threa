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

**Status**: ✅ COMPLETED
**Progress**: 13/13 sections complete

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

- `docs/preferred-models.md` - AI model recommendations with pricing
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

- **INV-16**: Extended to reference `docs/preferred-models.md` with AI assistant note

### Compression Results

- Removed 13 duplicate lessons (now covered by invariants)
- Compressed Shadcn UI section by ~75%
- Removed entire Agent Workflow section
- Streamlined all sections for clarity
