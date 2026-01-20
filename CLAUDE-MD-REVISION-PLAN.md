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

(none yet)

### 🔄 Current Section

**Section 1: "What Is This?"** (lines 1-8)

### ⏳ Remaining Sections

1. Runtime & Build (lines 9-18)
2. Project Structure (lines 20-31)
3. Tech Stack (lines 33-52)
4. Shadcn UI Reference (lines 54-86)
5. Core Concepts (lines 87-111)
6. Architecture Patterns (lines 113-141)
7. Database Philosophy (lines 142-148)
8. Project Invariants (lines 149-189)
9. Service Guidelines (lines 191-196)
10. AI Integration (lines 198-205)
11. Development (lines 207-274)
12. Agent Workflow (lines 276-356)
13. Lessons Learned (lines 357-564)

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

**Current**: Section 1 - "What Is This?"
**Progress**: 0/13 sections complete
