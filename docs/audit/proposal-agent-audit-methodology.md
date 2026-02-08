# Proposal: Agent Security Audit Methodology

## Context

We ran the same security audit on the Threa codebase with two different coding agents (Claude and Codex). Both found the same core vulnerabilities, but the quality and thoroughness of the output diverged significantly:

| Metric                 | Claude               | Codex                               |
| ---------------------- | -------------------- | ----------------------------------- |
| Test files added       | 0                    | 8                                   |
| New modules created    | 2                    | 9                                   |
| Docs produced          | 2 files              | 3 files (incl. prioritized backlog) |
| Defense layers per fix | 1                    | 2+                                  |
| Security defaults      | Permissive fallbacks | Fail-hard in production             |

Claude found one issue Codex missed (web search query data leakage). Codex found five issues Claude missed (`/metrics` unprotected, runtime tool trust boundary, global rate limit baseline, socket join callbacks, health/readiness separation). More importantly, on every shared finding, Codex's fix was more robust.

This document proposes changes to make Claude's audit behavior match or exceed the Codex baseline.

---

## Root Cause Analysis

The gaps trace to a single procedural mistake: **fixing as you find, instead of mapping first**.

Jumping straight to code meant:

- No systematic endpoint enumeration, so `/metrics` was invisible
- Each fix was "minimum correct" rather than defense-in-depth
- No test budget — fixes felt small enough to be obviously correct
- Inline changes to existing files rather than extracted, testable modules

Every other gap is a downstream consequence. The fix is structural: enforce a phased audit process.

### The compound cost of "efficient" minimal fixes

A single 4-line fix feels efficient. Ten 4-line fixes across an audit feels like fast progress. But each minimal fix is a decision to defer understanding: no test proving the vulnerability, no edge case analysis, no defense-in-depth, no extracted module. That deferred understanding compounds.

When the next developer touches the redirect code, they see `url.startsWith("/")` and have no test explaining what it guards against. They refactor, the check disappears, the vulnerability reopens silently. Multiply this by every minimal fix in the audit and you've created a maintenance surface where every future change risks reintroducing a security hole that nobody knows existed — because nothing in the code or tests records that knowledge.

Ten "efficient" 4-line fixes cost more in the long run than five thorough 40-line fixes with tests, because the thorough fixes _stay fixed_. The 4-line fix optimizes for the agent's time today at the cost of every developer's time forever after. A robust fix with a test is documentation, regression protection, and defense-in-depth in one artifact. A 4-line fix is a hope that nobody touches this code again.

---

## Proposed Changes

### 1. Phased Audit Process (CLAUDE.md addition)

Add to the `Working with Kris` protocol, or as a standalone methodology the agent can reference when asked to perform a security audit.

#### Phase 1: Map the Surface (no code changes)

Produce a complete inventory before touching any code:

- **HTTP endpoints**: method, path, authentication, authorization, rate limiting, input validation
- **Socket events**: event name, scope (stream/workspace/global), payload contents, who receives
- **External API calls**: what service, what data is sent, what secrets are used
- **Environment variables**: security-relevant vars, what happens when unset, default behavior
- **Auth flows**: every path from unauthenticated to authenticated, every redirect
- **Middleware chain**: what runs in what order, what's missing

Deliver as a structured document. Fix nothing until Kris reviews and confirms the surface area map.

**Why this matters:** The map is where findings come from. A gap in the map guarantees a gap in findings. Codex's `notes.md` (324 lines of analysis) is what enabled them to catch `/metrics` — they listed every endpoint before deciding what to fix.

#### Phase 2: Classify and Prioritize (no code changes)

For each finding from the surface map:

- **Severity**: Critical / High / Medium / Low
- **Exploitability**: How easy is this to exploit? What does an attacker need?
- **Blast radius**: What's compromised if exploited?
- **Fix complexity**: How many files, what's the risk of regression?

Deliver as a prioritized backlog. Get Kris's sign-off on priorities before writing code.

#### Phase 3: Fix with Tests

For each fix, in priority order:

1. Write a failing test that proves the vulnerability exists on `main`
2. Implement the fix
3. Run the test, verify it passes
4. Move to the next fix

One fix at a time. Each fix is a separate commit. Each commit includes its test.

### 2. Security Fix Completeness Definition (CLAUDE.md invariant)

Every security fix must satisfy all five criteria:

| #   | Criterion                                       | Rationale                                                                                                                                                                                      |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Test proving the vulnerability**              | A test that fails on `main` and passes on the fix. Without this, regressions are silent.                                                                                                       |
| 2   | **Defense-in-depth (2+ layers)**                | At least two independent checks that would each independently prevent exploitation. Prompt-level alone is insufficient. Single env check alone is insufficient.                                |
| 3   | **Fail-hard on misconfiguration**               | Security defaults must be restrictive. Unconfigured in production = throw, not degrade to permissive. No silent fallbacks (INV-11 applied to security).                                        |
| 4   | **Extracted module with single responsibility** | New security logic gets its own file and test file. Don't bolt `requireRole` onto `workspace.ts` — create `authorization.ts` + `authorization.test.ts`.                                        |
| 5   | **Production-hostile assumption**               | For every fix, answer: "What if the operator forgets to configure this?" and "What if an attacker sends a crafted value?" If either answer is "degrades to permissive," the fix is incomplete. |

### 3. Security Review Checklist (reference during Phase 1)

When mapping the surface area, explicitly check:

```
Authentication & Authorization
[ ] Every endpoint has explicit auth (no accidental public routes)
[ ] Every endpoint has explicit authorization (role checks, ownership checks)
[ ] Auth middleware ordering is correct (auth before authz before handler)
[ ] Stub/dev auth cannot activate in production (multiple independent guards)
[ ] Session tokens have appropriate expiry and rotation

Input & Output
[ ] All redirects validate destination (origin check, not just prefix)
[ ] All user input is validated at the boundary (schemas, length limits)
[ ] All error responses avoid leaking internals (stack traces, SQL, config)
[ ] All debug/diagnostic output strips sensitive data

Rate Limiting & Abuse
[ ] Global baseline rate limit exists (safety net for new/forgotten routes)
[ ] Sensitive endpoints have targeted limits (auth, AI, search, uploads)
[ ] Rate limit headers are set (clients can self-regulate)

Real-time / WebSocket
[ ] Every event is scoped correctly (stream vs workspace vs global)
[ ] Event payloads don't leak content to unauthorized recipients
[ ] Room joins are authorized and acknowledged

External Integrations
[ ] Outbound API calls don't leak internal data (IDs, tokens, secrets)
[ ] Webhook/callback URLs are validated
[ ] Third-party responses are treated as untrusted

AI / Agent Security
[ ] Tool outputs have runtime sanitization (not just prompt instructions)
[ ] System prompts instruct against injection, credential disclosure
[ ] Agent actions are bounded (can't escalate beyond intended scope)

Infrastructure
[ ] Security headers configured explicitly (CSP, HSTS, referrer policy)
[ ] CORS fails hard when unconfigured in production
[ ] Operational endpoints (/metrics, /debug) are access-controlled
[ ] Health vs readiness probes are separated
[ ] x-powered-by and server version headers are suppressed
```

---

## What This Changes in Practice

**Before** (what Claude did):

```
Find issue → Write minimal fix → Next issue → Ship with no tests
```

**After** (proposed):

```
Map everything → Prioritize with Kris → Fix one at a time → Each fix has a test → Each fix has 2+ defense layers
```

The mapping phase is the highest-leverage change. It forces systematic enumeration, which is what catches the things you weren't looking for. The completeness definition prevents "minimum viable fix" from becoming the standard.

---

## Trade-offs

**The upfront time investment is almost always worth it.** The mapping phase adds time before any code is written, but this is not a real cost. Speed comes from parallelization — once the map and priorities exist, multiple agents can work on independent fixes concurrently. The bottleneck is never "how fast can the agent type code." The bottleneck is "does the agent understand the problem well enough to fix it correctly the first time." Rushing the understanding phase doesn't save time; it creates rework.

**This produces more files.** Extracted modules + test files means more files in the PR. The codex branch touched 35 files vs our 17. More files to review, but each file is focused and independently understandable.

**This requires Kris checkpoints.** Two explicit review points (after mapping, after prioritization) before code starts. This is by design — security decisions shouldn't be made autonomously by the agent.

---

## Open Questions

1. **Where should the methodology live?** Options: CLAUDE.md invariant section, standalone doc referenced from CLAUDE.md, or a skill that gets invoked with `/security-audit`.

2. **Should the surface area map be a committed artifact?** Codex committed `notes.md` and `golden-audit-backlog.md`. Having the map in the repo means future audits can diff against it.

3. **Per-fix commits or batched?** Proposal says one fix per commit. This makes bisecting easier but produces more commits. Kris preference?

4. **How strict on the "2+ defense layers" rule?** Some fixes genuinely only need one layer (e.g., stripping `lastQueryText` from debug output). Should the rule be "2+ layers where feasible" or absolute?
