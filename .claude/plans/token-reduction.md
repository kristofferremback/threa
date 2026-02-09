# Token Reduction Plan

## Problem

Every API turn loads ~17K tokens of system context before any conversation content:

| File                             | Bytes  | Est. Tokens | % of tax |
| -------------------------------- | ------ | ----------- | -------- |
| Global `~/.claude/CLAUDE.md`     | 18,321 | ~4,600      | 27%      |
| Project `CLAUDE.md`              | 36,953 | ~9,200      | 54%      |
| `MEMORY.md`                      | 1,359  | ~340        | 2%       |
| System boilerplate + skill names | ~?     | ~3,000+     | 17%      |

A simple "yes" exchange costs 17K tokens. A 30-turn session costs 500K+ tokens in context alone — before tool results, file reads, or conversation.

The `/code-review` skill compounds this: it spawns 6 Sonnet agents + N Haiku scorers, each paying their own context tax plus large diff payloads.

**Target:** Cut per-turn context from ~17K to ~9K tokens (~47% reduction).

---

## Redundancy Map (Global ↔ Project)

These concepts appear in BOTH files. The project invariants are the authoritative source for Threa, so the global versions are pure waste in this project:

| Global CLAUDE.md Section                     | Project CLAUDE.md Invariant | Lines wasted |
| -------------------------------------------- | --------------------------- | ------------ |
| "No nested ternaries" (297-317)              | INV-47 (340-355)            | ~35          |
| "No speculative features" (276-295)          | INV-36 (292)                | ~20          |
| "Delete dead code" (208-224)                 | INV-38 (296)                | ~15          |
| "Decompose early, generalize late" (226-274) | INV-29 + INV-43             | ~48          |
| "Compare objects, not fields" (386-411)      | INV-24 (238)                | ~26          |
| "No .skip()/.todo()" (467-469)               | INV-26 (242)                | ~3           |
| "Always fix failing tests" (471-473)         | INV-22 (234)                | ~3           |
| "Comments explain WHY" (154-206)             | INV-25 (240)                | ~52          |
| "Abstractions must own domain" (319-323)     | Lessons Learned (566-568)   | ~5           |

Additionally within the project CLAUDE.md itself:

- "Architecture Patterns" section (159-179) is redundant with "Backend Architecture Quick Reference" (385-401) — both describe the same three-layer model.
- "Lessons Learned" section (512-584) mostly restates invariants (INV-30 = withClient, INV-29/43 = config sprawl, INV-45 = evals, INV-22 = fix tests).

---

## Plan: Global `~/.claude/CLAUDE.md`

**Current:** 473 lines, 18,321 bytes (~4,600 tokens)
**Target:** ~150 lines, ~6,000 bytes (~1,500 tokens)

**Important constraint:** This file serves ALL projects (Threa worktrees + personal-site + recommendli). It must remain self-contained. But code examples that just illustrate an already-clear principle are safe to cut — the principle sentence is what does the work.

### Section-by-section plan

#### KEEP AS-IS (behavioral shaping — these change how Claude operates)

These sections are concise and alter Claude's behavior at a fundamental level. They're worth every token.

- **"How We Work"** (lines 1-9, 9 lines): Defines autonomy model, "Kris", no "absolutely right"
- **"When Surprised, Stop"** (lines 28-36, 9 lines): Critical behavioral directive
- **"Autonomy and Judgment"** (lines 88-103, 16 lines): When to punt vs push back
- **"Context Window Awareness"** (lines 107-111, 5 lines)
- **"Handoff Protocol"** (lines 115-122, 8 lines)

#### CONDENSE (principle needed, examples bloated)

Each of these has 1-2 sentence principles that do the work, followed by 10-50 lines of examples that illustrate but don't add behavioral signal:

**"Understand Before Acting"** (lines 13-24, 12 lines → 8 lines)

- Keep the "Map first, then fix" paragraph and "Three passes" list
- Cut the final paragraph ("The third pass is where...") — the three-pass list already implies this

**"Fail Loudly"** (lines 40-46, 7 lines → keep as-is)

- Already concise. Three bullet points, no examples. Keep.

**"Invest Upfront"** (lines 50-57, 8 lines → keep as-is)

- Already concise. Four bullets, no examples. Keep.

**"Before Changing, Understand Why It Exists"** (lines 61-69, 9 lines → keep as-is)

- Already concise. Keep.

**"Trace the Graph"** (lines 73-84, 12 lines → keep as-is)

- Already concise. Keep.

#### CONDENSE HEAVILY (cut examples, keep principle only)

**"`git add .` is forbidden"** (lines 128-139, 12 lines → 1 line)

- Replace with: `**git add . is forbidden** — add files individually. Know what you're committing.`
- The bash example adds nothing — the rule is clear from the sentence.
- **Regression risk:** None. The principle is unambiguous.

**"No unnecessary changes"** (lines 141-152, 12 lines → 2 lines)

- Replace with: `**No unnecessary changes** — Don't update READMEs, rename variables, or add comments unless it's part of the change. Unnecessary diffs waste review time and obscure the actual change.`
- Cut the typescript diff example.
- **Regression risk:** Low. The sentence is clear. Claude occasionally still does "while I'm here" changes but the example doesn't prevent that — the principle does.

**"Comments explain WHY, not WHAT"** (lines 154-206, 52 lines → 3 lines)

- Replace with: `**Comments explain WHY, not WHAT** — If a comment restates the code, delete it. Comments earn their keep by explaining intent, constraints, or non-obvious decisions. Change justification comments ("Refactored to X", "Changed from Y") go in commit messages, not code.`
- Cut all 6 good/bad examples (48 lines).
- **Regression risk:** Low. This is also covered by INV-25 in Threa. For other projects, the principle sentence is sufficient — Claude's training already biases toward good commenting.

**"Delete dead code"** (lines 208-224, 17 lines → 1 line)

- Replace with: `**Delete dead code immediately** — Git has history. Commented-out code is noise. Deprecated aliases are dead code with extra steps.`
- **Regression risk:** None. Redundant with INV-38.

**"Decompose early, generalize late"** (lines 226-274, 48 lines → 3 lines)

- Replace with: `**Decompose early, generalize late** — Break large things into named, focused pieces (readability, not premature abstraction). A 200-line component should be five 40-line files. But don't build generic frameworks until you have three real use cases.`
- Cut the 42-line code example (good/bad/bad patterns).
- **Regression risk:** Low-Medium. The SMART_SECTIONS example is a good teaching tool. But INV-29/INV-43 in Threa's project CLAUDE.md covers the same ground. For non-Threa projects, the principle statement is enough.

**"No speculative features"** (lines 276-295, 20 lines → 2 lines)

- Replace with: `**No speculative features** — Don't add features, configuration, or comments for imagined requirements. YAGNI applies to code AND comments. Build what's needed now.`
- **Regression risk:** None. Redundant with INV-36.

**"No nested ternaries"** (lines 297-317, 20 lines → 1 line)

- Replace with: `**No nested ternaries** — One level of ternary is fine. Two or more is not. Use conditionals, early returns, or lookups instead.`
- **Regression risk:** None. Redundant with INV-47.

**"Abstractions must fully own their domain"** (lines 319-323, 5 lines → keep as-is)

- Already concise, no example. Keep.

#### CONDENSE HEAVILY (On Tests section)

**"Test names are documentation"** (lines 329-356, 28 lines → 3 lines)

- Replace with: `**Test names are documentation** — Use the "should X when Y" pattern. When a test fails, the name alone should tell you whether it's a regression or a bad test. Bad: "happy path", "test retry", "handles error".`
- Cut the 20-line good/bad/framework examples.
- **Regression risk:** Low. The "should X when Y" pattern instruction is the actionable part.

**"Each test verifies ONE behavior"** (lines 358-384, 26 lines → 2 lines)

- Replace with: `**Each test verifies ONE behavior** — Don't repeat assertions tested elsewhere. Don't verify setup. Focus on what's unique to this test case.`
- Cut the 20-line code example.
- **Regression risk:** Low.

**"Compare objects, not fields"** (lines 386-411, 26 lines → 2 lines)

- Replace with: `**Compare objects, not fields** — Build a want object, compare once with toMatchObject/toEqual. Don't use sequential assert chains.`
- Cut the 22-line multi-language example.
- **Regression risk:** None. Redundant with INV-24.

**"Test behavior, not implementation"** (lines 413-428, 16 lines → 2 lines)

- Replace with: `**Test behavior, not implementation** — Tests should survive refactoring. Verify what the system does, not how it does it. Don't assert on spy call counts or internal event counts.`
- **Regression risk:** Low.

**"Use randomized IDs"** (lines 430-442, 13 lines → 1 line)

- Replace with: `**Use randomized IDs for test isolation** — Use crypto.randomUUID() with readable prefixes. Hardcoded IDs cause collisions in parallel tests.`
- **Regression risk:** None.

**"Parameterized tests"** (lines 444-465, 22 lines → 2 lines)

- Replace with: `**Parameterized tests for variants** — Use it.each/table patterns when cases differ only in input/output. But don't force parameterization when cases need different setup/assertions.`
- **Regression risk:** Low.

**"No .skip()/.todo()"** (lines 467-469, 3 lines → keep as-is)

- Already 3 lines. Keep.

**"Always fix failing tests"** (lines 471-473, 3 lines → keep as-is)

- Already 3 lines. Keep.

### Global CLAUDE.md summary

| Section                              | Current lines | Target lines | Saved    |
| ------------------------------------ | ------------- | ------------ | -------- |
| How We Work through Handoff Protocol | ~122          | ~118         | 4        |
| On Code (7 subsections)              | ~196          | ~20          | 176      |
| On Tests (8 subsections)             | ~145          | ~22          | 123      |
| **Total**                            | **473**       | **~160**     | **~313** |

**Estimated savings: ~12,000 bytes → ~3,000 tokens per turn**

---

## Plan: Project `CLAUDE.md`

**Current:** 584 lines, 36,953 bytes (~9,200 tokens)
**Target:** ~280 lines, ~16,000 bytes (~4,000 tokens)

### Section-by-section plan

#### KEEP AS-IS

- **"What Is This?"** (lines 1-7): Brief context, 7 lines
- **"Runtime & Build"** (lines 9-18): Essential, prevents wrong tool usage
- **"Project Structure"** (lines 20-71): Essential for navigation
- **"Database Philosophy"** (lines 181-186): 4 lines, essential
- **"Backend Architecture Quick Reference"** (lines 385-401): Concise, essential
- **Invariants preamble + new-invariant instructions** (lines 188-191, 379-383)

#### MOVE TO SEPARATE DOC: `.claude/reference.md`

These sections are reference material that's rarely relevant per-turn. Create a single `.claude/reference.md` and replace each section in CLAUDE.md with a one-line pointer.

**"Tech Stack"** (lines 73-102, 30 lines → 1 line)

- Move to `.claude/reference.md` under "## Tech Stack"
- Replace with: `**Tech stack:** See .claude/reference.md. Key: Bun runtime, Express v5, PostgreSQL/squid, Socket.io, React 19, Shadcn UI, Vercel AI SDK + LangChain.`
- **Regression risk:** Low. Tech stack details are needed when picking libraries/tools but Claude can read the reference doc when relevant. The inline one-liner captures the most important bits (Bun, Express v5, squid, Shadcn).

**"Design System References"** (lines 104-117, 14 lines → 1 line)

- Move to `.claude/reference.md`
- Replace with: `**Design system:** See docs/design-system.md and docs/design-system-kitchen-sink.html.`
- **Regression risk:** None. Already just pointers.

**"Local Development"** (lines 119-134, 16 lines → 1 line)

- Move to `.claude/reference.md`
- Replace with: `**Local dev:** bun run dev:test for stub auth. See docs/agent-testing-guide.md.`
- **Regression risk:** Low. Agent mostly doesn't need to start dev servers.

**"Shadcn UI"** (lines 136-147, 12 lines → 1 line)

- Merge the key instruction into the "Design system" one-liner above
- Replace with: `**Shadcn UI (INV-14):** bunx shadcn@latest add <name> from apps/frontend/. Golden Thread theme — warm neutrals + gold accents.`
- **Regression risk:** Low. INV-14 already captures the rule. The install command is the only actionable piece.

**"Core Concepts"** (lines 149-157, 9 lines → 1 line)

- Move to `.claude/reference.md`
- Replace with: `**Core concepts:** Streams (scratchpad/channel/dm/thread), Memos (GAM knowledge extraction), Personas (data-driven AI agents). See docs/core-concepts.md.`
- **Regression risk:** Low-Medium. The pipeline details (MemoAccumulator → Classifier → Memorizer → Enrichment) are useful when working on memos. But that's only relevant for memo-specific work, and the agent can read docs/core-concepts.md or the feature code itself.

**"Architecture Patterns"** (lines 159-179, 21 lines → DELETE)

- Remove entirely. "Backend Architecture Quick Reference" (lines 385-401) covers the same three-layer model more concisely, and already says "See docs/architecture.md for detailed patterns."
- **Regression risk:** None. Pure redundancy.

**"AI Integration"** (lines 403-429, 27 lines → 3 lines)

- Move details to `.claude/reference.md`
- Replace with: `**AI integration:** All AI calls through createAI() wrapper (INV-28). Model format: provider:modelPath. Telemetry required (INV-19). See docs/model-reference.md and docs/backend/ai-integration.md.`
- **Regression risk:** Low. The code example is nice but INV-19 and INV-28 already capture the requirements. The model format one-liner is the most important piece.

**"Development" section** (lines 431-510, 80 lines → 3 lines)

- Move all of "Primary Folder Workflow", "Git Worktrees", and "Langfuse" to `.claude/reference.md`
- Replace with:
  ```
  **Development:** Database/infra only in primary /threa folder, never worktrees. Feature work in worktrees (bun run setup:worktree). See .claude/reference.md for full setup.
  ```
- **Regression risk:** Low. Worktree setup is a one-time operation. The critical rule (don't run db:start from worktrees) fits in one sentence.

**"Lessons Learned"** (lines 512-584, 73 lines → DELETE)

- Remove entirely. Every lesson is already captured by an invariant or the global CLAUDE.md:
  - "Foundation code" → Global CLAUDE.md "Invest Upfront"
  - "URL structure encodes domain truths" → Interesting but doesn't affect Claude's behavior
  - "Authorization middleware" → Good pattern but not a per-turn rule
  - "Push checks up, consolidate down" → General principle, already in architecture docs
  - "Compose small middlewares" → Described in "Backend Architecture Quick Reference"
  - "Abstractions should fully own domain" → Global CLAUDE.md already has this
  - "withClient for connection affinity" → INV-30
  - "Config sprawl" → INV-29 + INV-43
  - "Evals that recreate production logic" → INV-45
- **Regression risk:** Low. These are "learned the hard way" notes that informed the invariants. The invariants are the codified form. The lessons are the backstory.

#### CONDENSE INVARIANTS

Most invariants are already one-liners. These have inline code examples or multi-line elaboration that can be trimmed:

**INV-29** (lines 248-278, 30 lines → 3 lines): Cut the 20-line code example. The one-liner + anti-pattern bullets are sufficient. If Claude needs the example, it can read the code itself.

- **Regression risk:** Low. INV-43 also covers this with its own "signs of sprawl" checklist.

**INV-41** (lines 302, 1 long line → keep as-is): This one is critical and already a single (long) line. The three-phase pattern is non-obvious enough that the inline explanation earns its keep.

**INV-43** (lines 306-315, 10 lines → 3 lines): Keep the one-liner and "signs of sprawl" list (4 bullets). Cut "The fix" paragraph — it's the same as INV-29.

- **Regression risk:** None. The signs-of-sprawl checklist is the actionable part.

**INV-45** (lines 319-337, 19 lines → 3 lines): Keep one-liner. Cut "Signs of violation" list and "Examples of correct patterns" — the one-liner ("call the same entry points production uses") is clear enough.

- **Regression risk:** Low-Medium. The "signs of violation" list helps catch subtle cases. But the principle is clear.

**INV-47** (lines 340-355, 15 lines → 1 line): Cut the 13-line code example. Already covered by global CLAUDE.md.

- **Regression risk:** None. Redundant.

**INV-48** (lines 357-369, 13 lines → 2 lines): Cut the 10-line code example. Keep the one-liner + the "if you MUST use mock.module()" qualifier.

- **Regression risk:** Low. The one-liner is clear. The code example just illustrates spyOn syntax which Claude already knows.

### Project CLAUDE.md summary

| Section                        | Current lines | Target lines | Saved    |
| ------------------------------ | ------------- | ------------ | -------- |
| Header + Runtime + Structure   | 71            | 71           | 0        |
| Tech Stack → reference         | 30            | 1            | 29       |
| Design System → reference      | 14            | 1            | 13       |
| Local Dev → reference          | 16            | 1            | 15       |
| Shadcn UI → inline             | 12            | 1            | 11       |
| Core Concepts → reference      | 9             | 1            | 8        |
| Architecture Patterns → delete | 21            | 0            | 21       |
| Database Philosophy            | 6             | 6            | 0        |
| Invariants (52)                | ~195          | ~145         | 50       |
| Backend Quick Reference        | 17            | 17           | 0        |
| AI Integration → reference     | 27            | 3            | 24       |
| Development → reference        | 80            | 3            | 77       |
| Lessons Learned → delete       | 73            | 0            | 73       |
| **Total**                      | **584**       | **~260**     | **~324** |

**Estimated savings: ~21,000 bytes → ~5,200 tokens per turn**

---

## Combined Impact

|                       | Before             | After             | Saved per turn   |
| --------------------- | ------------------ | ----------------- | ---------------- |
| Global CLAUDE.md      | ~4,600 tokens      | ~1,500 tokens     | 3,100            |
| Project CLAUDE.md     | ~9,200 tokens      | ~4,000 tokens     | 5,200            |
| MEMORY.md             | ~340 tokens        | ~340 tokens       | 0                |
| **Total context tax** | **~14,100 tokens** | **~5,800 tokens** | **~8,300 (59%)** |

Over a 30-turn session: **~249K fewer tokens** (just in context loading, before tool results).

---

## New File: `.claude/reference.md`

Absorbs all moved content. Estimated size: ~12,000 bytes. This file is NOT auto-loaded — Claude reads it on-demand when working on relevant tasks.

Contents:

1. Tech Stack (backend + frontend details)
2. Design System References
3. Core Concepts (streams, memos, personas pipeline details)
4. Local Development (agent-friendly, stub auth)
5. Shadcn UI (detailed install instructions, theme details)
6. AI Integration (wrapper details, code example, cost tracking)
7. Development Workflows (primary folder, worktrees, langfuse, credentials)

---

## Regression Risk Assessment

### High-confidence: No regression

- Removing code examples from invariants that are clear from the one-liner (INV-47, INV-48)
- Removing "Architecture Patterns" (redundant with "Backend Architecture Quick Reference")
- Removing "Lessons Learned" (codified into invariants)
- Removing global CLAUDE.md examples that are redundant with project invariants

### Low risk: Monitor for 1-2 sessions

- Moving "Tech Stack" — Claude might occasionally pick wrong tool (e.g., npm instead of bun). Mitigated by "Runtime & Build" section staying inline.
- Moving "Core Concepts" — Claude might miss memo pipeline details. Mitigated by the one-liner keeping key terms discoverable.
- Moving "Development" — Claude might try to run db:start from worktree. Mitigated by the inline one-liner keeping the critical rule.

### Medium risk: Watch carefully

- Cutting global CLAUDE.md examples for non-Threa projects. The personal-site and recommendli projects lose the detailed examples. If Claude starts writing bad test patterns or nested ternaries in those repos, the examples may need to be restored — but consider adding project-level CLAUDE.md files for those repos instead.
- Condensing INV-45 (evals call production entry points) — the "signs of violation" list catches subtle cases. If eval quality drops, restore it.

---

## Phase 3: Compression (applied to everything that survives)

Per the approach in `docs/CLAUDE-md-context-management.md`: systematically remove articles, filler words, redundant phrases, verbose constructions — while preserving all meaning. This phase applies to BOTH the kept behavioral sections and the surviving invariants.

### Compression technique

- Unnecessary articles: "the", "a" where meaning is clear without
- Filler: "This applies everywhere", "This is not", "This means"
- Verbose → direct: "which provides" → "providing", "you're choosing between" → "choosing between"
- Redundant qualifiers: "almost always", "actually", "really"
- Sentence restructuring: "When X, your Y" → "X → Y"

### Global CLAUDE.md: Behavioral sections compressed

These sections were marked "keep as-is" in the plan above. Compression squeezes another ~15-20% from each.

**"How We Work"** (9 lines → 7 lines):

```
BEFORE:
You're autonomous. Say what you're going to do, do it, then report what happened.
Don't ask permission for every step — Kris trusts your judgment. But make your
reasoning visible so Kris can course-correct early when your model is wrong.

When you're uncertain, say so. When you see something Kris might not, share it.
When you disagree, state the disagreement concretely and defer to Kris's decision.
You're a collaborator, not a shell script.

AFTER:
Autonomous. Say what you'll do, do it, report what happened. Don't ask permission
— make reasoning visible so Kris can course-correct when your model is wrong.

Uncertain? Say so. See something Kris might not? Share it. Disagree? State it
concretely, defer to Kris's decision. Collaborator, not shell script.
```

**"Understand Before Acting"** (12 lines → 7 lines):

```
BEFORE:
The most expensive mistake is fixing something you haven't fully understood. The
urge to act immediately feels efficient but compounds — ten quick fixes cost more
than five thorough ones because the quick fixes don't stay fixed.

**Map first, then fix.** Read the relevant code, trace the dependencies, understand
the existing patterns. Only once you're confident you understand the problem *and*
its context should you start writing code.

**Three passes for new code:**
1. Make it work and look correct
2. Refactor for readability — extract patterns, minimize complexity
3. Step back: what assumptions will break for other cases? What implicit coupling
   exists? Can parameters be reduced?

The third pass is where 4-line fixes become robust 40-line fixes. [CUT]

AFTER:
Most expensive mistake: fixing what you haven't understood. Quick fixes compound —
ten cost more than five thorough ones.

**Map first, then fix.** Read code, trace dependencies, understand patterns. Only
write code once you understand problem *and* context.

**Three passes:**
1. Make it work correctly
2. Refactor for readability — extract patterns, minimize complexity
3. Step back: assumptions that break for other cases? Implicit coupling? Reducible
   parameters?
```

**"Fail Loudly"** (7 lines → 5 lines):

```
BEFORE:
Silent fallbacks convert hard failures (informative) into silent corruption
(expensive). This applies everywhere:

- **Defaults must be restrictive.** If `CORS_ORIGIN` is unset in production,
  throw — don't fall back to permissive. Unconfigured should mean broken, not open.
- **Errors should say what to do about them.** "Error: Invalid input" is worthless.
  "Error: Expected integer for port, got 'abc'" fixes itself.
- **Let it crash.** Crashes are data. `or {}` is a lie you tell yourself.

AFTER:
Silent fallbacks convert hard failures (informative) into silent corruption
(expensive).

- **Restrictive defaults.** `CORS_ORIGIN` unset in production → throw, not
  permissive fallback.
- **Actionable errors.** "Invalid input" is worthless. "Expected integer for port,
  got 'abc'" fixes itself.
- **Let it crash.** Crashes are data. `or {}` is a lie.
```

**"Invest Upfront"** (8 lines → 6 lines):

```
BEFORE:
The bottleneck is never typing speed. It's understanding. An upfront time
investment in mapping, testing, and robustness is almost always better than
shipping fast and revisiting later.

- **Tests are part of the fix**, not a follow-up. A fix without a test is a hope
  that nobody touches this code again.
- **Robust over minimal.** A 4-line fix that handles the common case will eventually
  need another 4-line fix for the edge case, then another for the next edge case.
  The 40-line fix that handles all cases upfront is less total work.

AFTER:
Bottleneck is understanding, not typing. Upfront investment in mapping, testing,
robustness beats shipping fast and revisiting.

- **Tests are part of the fix.** Fix without test = hope nobody touches this again.
- **Robust over minimal.** 4-line common-case fix eventually needs more for edge
  cases. 40-line fix handling all cases = less total work.
```

**"Autonomy and Judgment"** (16 lines → 12 lines):

```
BEFORE:
**Punt to Kris when:**
- The intent is ambiguous and being wrong costs more than asking
- You discover a scope change or unexpected state with multiple explanations
- You're choosing between valid approaches with real tradeoffs
- Something is irreversible (database schemas, public APIs, data deletion, git
  history)

State the concern concretely, share what you know, propose an alternative if you
have one, then defer.

AFTER:
**Punt to Kris when:**
- Intent ambiguous, being wrong costs more than asking
- Scope change or unexpected state with multiple explanations
- Choosing between valid approaches with real tradeoffs
- Irreversible (database schemas, public APIs, data deletion, git history)

State concern concretely, share what you know, propose alternative, defer.
```

**"When Surprised, Stop"** (9 lines → 7 lines):

```
BEFORE:
When reality contradicts your expectation, your model is wrong. Don't push past it.
The "should" trap: "This should work but doesn't" means your "should" is built on
false premises. Debug your map, not reality.

AFTER:
Reality contradicts expectation → your model is wrong. Don't push past it.
"Should" trap: "This should work but doesn't" = false premises. Debug your map,
not reality.
```

### Project CLAUDE.md: Invariant compression examples

Apply same technique to all 52 invariants. Biggest wins on verbose ones:

**INV-9** (save ~20 chars):

```
BEFORE: Pass dependencies explicitly; no module-level state or `getInstance()`.
Exceptions: (1) Logger (Pino) - stateless, side-effect-free. (2) Langfuse/OTEL
SDK - must initialize before LangChain imports for instrumentation; forces
module-level state.

AFTER: Pass deps explicitly; no module-level state or `getInstance()`. Exceptions:
(1) Logger (Pino) — stateless. (2) Langfuse/OTEL — must init before LangChain
imports; forces module-level state.
```

**INV-20** (save ~30 chars):

```
BEFORE: Never SELECT-then-UPDATE/INSERT without concurrency control. Has race
conditions. Use atomic operations: `INSERT ... ON CONFLICT DO UPDATE` for upserts,
`UPDATE ... WHERE` with row-level conditions, or explicit locking (`SELECT FOR
UPDATE`). For check-then-act, use serializable transactions or optimistic locking
with version columns.

AFTER: Never SELECT-then-UPDATE/INSERT without concurrency control — race
conditions. Use: `INSERT ... ON CONFLICT DO UPDATE`, `UPDATE ... WHERE` with
row-level conditions, `SELECT FOR UPDATE`. Check-then-act: serializable
transactions or optimistic locking.
```

**INV-41** (save ~80 chars — the longest invariant):

```
BEFORE: NEVER hold database connections (withTransaction or withClient) during slow
operations like AI/LLM calls (1-5+ seconds). This causes pool exhaustion. Use
three-phase pattern: **Phase 1**: Fetch all needed data with withClient (fast reads,
~100-200ms). **Phase 2**: Perform slow operation with NO database connection held
(AI calls, external APIs, heavy computation). **Phase 3**: Save results with
withTransaction, re-checking state to handle race conditions (fast writes, ~100ms).
Re-checking prevents corruption when another process modified data during Phase 2.
Accept wasted work (e.g., discarded AI call) to prevent pool exhaustion - holding
connections blocks all concurrent requests.

AFTER: NEVER hold db connections during slow operations (AI/LLM, 1-5+ sec) —
pool exhaustion. **Phase 1:** Fetch data with withClient (fast reads). **Phase 2:**
Slow operation, NO connection held. **Phase 3:** Save with withTransaction,
re-check state for race conditions. Accept wasted work (discarded AI call) over
pool exhaustion.
```

**INV-42** (save ~60 chars):

```
BEFORE: NEVER use server time (`new Date()`) or assume local timezone when
displaying or anchoring dates for users. ALWAYS resolve timezone from the relevant
user(s). For single-user context (messages, scratchpads): use the author's
timezone. For multi-user context (conversations, channels): use the first user
message author's timezone, or canonical invoking user. Store timezone on User
(`user.timezone`), pass through context, and use `formatDate(date, timezone,
format)` from `lib/temporal.ts`.

AFTER: NEVER use server time or assume local timezone for user-facing dates.
Resolve timezone from relevant user(s). Single-user: author's timezone.
Multi-user: first message author's timezone. Use `formatDate(date, timezone,
format)` from `lib/temporal.ts`.
```

### Estimated additional savings from compression

Compression achieves ~5-8% character reduction on already-concise text (per the Phase 3 results in the context management doc). Applied to the ~16KB of surviving content:

- Global CLAUDE.md surviving text (~6KB): ~400-500 bytes saved
- Project CLAUDE.md surviving text (~16KB): ~1,000-1,300 bytes saved
- **Total additional savings: ~1,500-1,800 bytes → ~400-450 tokens per turn**

Not dramatic on its own, but it stacks with the structural cuts. And it makes every remaining line earn its keep.

### Updated combined impact with compression

|                    | Before        | After (structural) | After (+ compression) |
| ------------------ | ------------- | ------------------ | --------------------- |
| Global CLAUDE.md   | ~4,600 tokens | ~1,500             | ~1,350                |
| Project CLAUDE.md  | ~9,200 tokens | ~4,000             | ~3,650                |
| MEMORY.md          | ~340 tokens   | ~340               | ~340                  |
| **Total**          | **~14,100**   | **~5,800**         | **~5,340**            |
| **Saved per turn** |               | **8,300 (59%)**    | **8,760 (62%)**       |

---

## Execution Steps

This should be done in a separate worktree (since it modifies CLAUDE.md which affects the current session).

### Step 1: Create `.claude/reference.md`

Create the new file. Copy these sections from project CLAUDE.md (verbatim):

- "Tech Stack" (lines 73-102)
- "Design System References" (lines 104-117)
- "Local Development" (lines 119-134)
- "Shadcn UI" (lines 136-147)
- "Core Concepts" (lines 149-157)
- "AI Integration" (lines 403-429)
- "Development" entire section (lines 431-510)

Format as a clean reference doc with a header explaining it's on-demand context.

### Step 2: Rewrite project `CLAUDE.md`

Three sub-steps:

1. **Structural:** Replace moved sections with one-liners. Delete "Architecture Patterns" and "Lessons Learned". Condense invariants INV-29, INV-43, INV-45, INV-47, INV-48.
2. **Compress:** Apply word-level compression to all remaining text — articles, filler, verbose constructions. Use examples from Phase 3 section above as guide.
3. **Verify:** `wc -c CLAUDE.md` should be ~14,000-15,000 bytes (down from 36,953).

### Step 3: Rewrite global `~/.claude/CLAUDE.md`

Three sub-steps:

1. **Structural:** Condense "On Code" and "On Tests" to principle-only bullets (cut all code examples).
2. **Compress:** Apply word-level compression to all behavioral sections. Use the before/after examples from Phase 3 section above.
3. **Verify:** `wc -c ~/.claude/CLAUDE.md` should be ~5,000-5,500 bytes (down from 18,321).

### Step 4: Verify no regressions

In a NEW conversation (so the new CLAUDE.md files load), do a smoke test:

- Ask Claude to write a test — does it use "should X when Y" naming? toMatchObject? randomized IDs?
- Ask Claude to add a feature — does it follow three-pass methodology? Use Bun, not Node?
- Ask Claude to commit — does it add files individually?
- Check that Claude still says "Kris" and doesn't say "you're absolutely right"

### Step 5: Clean up MEMORY.md

The MEMORY.md is fine at 1.4KB. No changes needed. But after verifying the new CLAUDE.md files work, consider removing the "Feature Colocation Migration" section if it's no longer relevant — that migration is complete.
