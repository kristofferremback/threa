# GBrain Concepts for Threa's Memory System

Status: exploration / suggestion. Not a committed implementation plan.
Scope: catalog every distinct memory/knowledge/retrieval idea in the gbrain
project, reframe each one for Threa's multiplayer + access-controlled setup,
and recommend what to adopt, adapt, defer, or reject.

gbrain was cloned to a gitignored working folder for study only. No gbrain code
is vendored. This document carries ideas, not code.

---

## 1. Why this document

gbrain is a single-user personal knowledge brain: one owner, one corpus, one
git-backed markdown system of record, a Postgres/pgvector cache, and an agent
that reads and maintains it. It has spent a lot of design effort on the parts
Threa has barely started: retrieval quality, ranking, scheduled synthesis, an
explicit epistemic data model, and evaluation discipline.

Threa's memory system (GAM) is good at _ingestion_ — conversation-boundary
extraction, debounced per-stream accumulation, classify → memorize → embed, all
multiplayer- and access-aware by construction. It is thin everywhere _after_
ingestion: retrieval is "semantic, else full-text fallback", there is no fusion,
no reranking, no scheduled synthesis, no eval harness, and the memo shape is
flat.

So the useful framing is not "gbrain vs GAM". It is: **GAM stays as the
ingestion core; gbrain's contribution is the retrieval, ranking, maintenance,
epistemic-model, and eval layers that sit around an ingestion core.** Section 5
answers the "is GAM still the answer" question directly.

The hard part is that **every** gbrain retrieval/ranking/graph/synthesis concept
assumes a single global corpus with no query-time access predicate. Threa's
corpus is partitioned by workspace, then by per-stream visibility and
membership, with thread access inheriting from the root stream. Porting any of
these naively leaks private content (DMs, private channels, scratchpads) into
surfaces the viewer should never see. Section 3 defines the single discipline
that every adopted concept must obey so that does not happen.

---

## 2. The reframing problem

gbrain's access story (concept 22/23 below) is: trusted local CLI sees
everything; a remote caller is constrained to coarse read/write/admin scopes and
a source-id isolation predicate; an `ACCESS_POLICY` markdown file describes
relationship tiers (Full/Work/Family/None) that the agent is _asked_ to respect.
That is a single-owner model with one privileged operator and advisory tiers.

Threa's access story is enforced, not advisory, and it is multi-party:

- Workspace is the hard shard boundary. Every memo/message query is
  workspace-scoped (INV-8). Cross-workspace is not a tier, it is impossible.
- Within a workspace, memo access is **not stored on the memo**. It is _derived_
  from the memo's source stream, resolved through the thread → root rule
  (`resolveEffectiveAccessStream`) and then the stream's visibility/membership
  (`checkStreamAccess` / `listAccessibleStreamIds` in
  `apps/backend/src/features/streams/access.ts`).
- A memo that combines messages from several streams is only as visible as its
  narrowest contributing source.

Because access is derived, not stored, correctness depends entirely on every
reader resolving the viewer's accessible stream set _first_ and constraining the
read to it. `MemoExplorerService` already does this correctly today: it takes
`permissions.accessibleStreamIds` as a required input, filters the search to it,
re-checks the source stream in `getById`, and re-filters every individual source
message in `loadSourceMessages`. That service is the reference pattern every
adopted gbrain concept must follow.

---

## 3. The access-control spine

One rule, stated once, referenced by every concept entry below.

### 3.1 The prime predicate

Every gbrain concept that reads, ranks, traverses, aggregates, dedups, reranks,
or synthesizes across the corpus must take a **resolved accessible-stream-id
set as a required, non-defaulting input**, and push it as a SQL predicate into
the **innermost** scan — before fusion, before ranking, before dedup, before
rerank, before any aggregate.

An access filter applied _after_ ranking/fusion/aggregation is a leak even if
the final rows are filtered, because it still:

- changes which results win a fixed top-k (a private high-scorer displaces a
  public result the viewer should have seen);
- leaks existence and counts (anomaly baselines, "N memos", expertise scores);
- poisons any shared cache with rows the next viewer cannot see.

This is the same structural reason gbrain pushes its source-isolation predicate
into the inner CTE of its two-stage hybrid search and keys its query cache on a
`knobs_hash`. Threa's analogue is: the predicate is the viewer's accessible
stream set, and the cache key must include a hash of that set.

`listAccessibleStreamIds` is already a single SQL round-trip producing exactly
this set. The work is to make it the inner predicate of every new retrieval
path, not a post-filter.

### 3.2 Two access modes that must never be conflated

- **Viewer access** — for any user-facing surface (memo explorer, search,
  ranking, discovery, maintenance dashboards). The full set of streams the
  signed-in user can read. Path: `listAccessibleStreamIds` /
  `resolveUserAccessibleStreamIds`. Mandated by `workspace-memory-explorer.md`
  R1: explorer boundaries are identical to retrieval boundaries; no broader
  workspace-level memo visibility concept.
- **Agent-invocation access** — for agent retrieval only. Intentionally
  _narrower_ and _context-dependent_: it depends on _where_ the agent was
  invoked, not just who invoked it (`computeAgentAccessSpec`,
  `AgentAccessSpec` = `user_full_access | public_only | public_plus_stream |
user_intersection`). An agent answering in a public channel must not surface
  the invoking user's private-DM knowledge to the channel.

Rule: a user browsing/ranking/maintenance surface uses **viewer** access; an
agent retrieval surface uses **agent-invocation** access. Picking the wrong one
is the leak. Several gbrain concepts (whoknows, salience, anomaly, dream
synthesis) are tempting to wire to "the workspace" — they must be wired to one
of these two scopes explicitly.

### 3.3 Per-hop re-filtering for any graph/traversal concept

gbrain's graph traversal, cross-session synthesis, and contradiction sampling
walk edges (`[[wikilinks]]`, shared sources, parent/child) freely. In Threa,
every hop can cross a visibility boundary. Any traversal must re-apply the
prime predicate **at each hop**, exactly like `loadSourceMessages` re-filters
each source message against `accessibleStreamIds` rather than trusting the
parent memo's scope. A reachable node is not an accessible node.

### 3.4 Most-restrictive inheritance for synthesis outputs

Any concept that _writes_ a synthesized artifact from multiple sources (dream
synthesize, patterns, consolidate, compiled-truth) must stamp the output's
effective scope as the **intersection (most restrictive)** of its contributing
sources' stream visibilities. Otherwise synthesis becomes a laundering channel:
a memo blending a private-channel fact and a public fact, surfaced workspace-
wide, has leaked the private fact's substance. "Most restrictive contributor
wins" is the default; promoting a synthesized memo to a broader scope is an
explicit, separate, audited action, never an emergent side effect of synthesis.

### 3.5 Caches and precomputed scores are per-scope

Any precomputed/global value gbrain stores once (query cache, emotional weight,
salience, anomaly baselines, expertise scores) is, in Threa, only valid for a
given viewer scope. Either key it by an accessible-scope hash, partition it by a
coarse public/workspace tier, or recompute per viewer. A globally shared
precompute over the whole workspace corpus is a leak surface.

With 3.1–3.5 fixed as the spine, the rest of this document is "which gbrain
ideas are worth the work, and what does the reframed version look like".

---

## 4. Concept catalog

Verdict vocabulary:

- **Adopt** — port largely as-is, wrapped with the §3 spine.
- **Adapt** — the idea is valuable but the multiplayer reframing materially
  changes its shape.
- **Defer** — valuable, lower priority or blocked on a prerequisite.
- **Reject** — does not fit Threa's architecture or domain.

### A. Knowledge model & system of record

**A1. Pages + wikilinks + timeline graph — Adapt (flagship spike).**
gbrain models each entity as one markdown page split into _compiled truth_
(mutable current synthesis, rewritten as evidence changes) and a _timeline_
(append-only, immutable evidence trail), with a hard invariant that every
compiled-truth claim traces to timeline entries. Threa memos today are flat
(title/abstract/keyPoints, supersede-on-revise). The compiled-truth/timeline
split is the single most architecturally interesting idea in gbrain and is
_compatible with GAM_ — it is a richer memo shape, not a GAM replacement.
Reframed: an entity/topic memo whose compiled-truth body is rewritten as
evidence accumulates, backed by an append-only provenance trail where **each
timeline entry carries its source stream id**. The memo's effective visibility
= the intersection of all contributing timeline entries' source-stream
visibilities (§3.4). The traceability invariant becomes a security invariant:
no compiled-truth sentence may exist without an accessible timeline entry behind
it, so a viewer who loses access to a source also loses the synthesized claim
derived from it. Worth a dedicated design spike; see §6 tier 3.

**A2. Markdown canonical, DB derived — Reject (keep the nugget).**
Threa's system of record is the event-sourced `stream_events` log + Postgres
projections, not a git markdown repo, and is inherently multi-writer and
concurrent. gbrain's "rebuild the DB from files" model assumes one push
authority and no per-user derived state. Reject the architecture. Keep one
nugget: gbrain's **forget contract** (a struck claim plus a
`superseded by`/`forgotten: <reason>` provenance note rather than a DELETE)
maps onto Threa's existing memo status lifecycle
(`draft → active → archived | superseded`); the only gap is recording an
explicit human-readable forget reason on supersession. Small, safe.

**A3. Brains vs sources (two-axis model) — Adopt (already structural).**
gbrain separates "which database" (brain) from "which repo inside it" (source),
and refuses to auto-join across brains in SQL — federation is an explicit
agent-level step. Threa already has this shape: region/workspace is the brain
axis, stream is the source axis, and the workspace shard boundary (INV-8) is
the no-auto-join rule. The portable principle worth writing down explicitly:
**never let a new retrieval path join across the workspace boundary, and never
let it treat "reachable" as "accessible" within a workspace** — federation/
cross-scope reads are explicit, access-checked steps, never emergent. Reinforces
existing posture; little new code, but it should be an acceptance criterion for
every new query path.

### B. Retrieval & ranking (the strongest cluster for Threa)

**B1. Hybrid search (vector + keyword + RRF + expansion + dedup) — Adopt.**
Threa's memo search today is semantic, with a full-text fallback only on
empty/failed semantic results (`MemoExplorerService.search`) — never both fused.
gbrain runs keyword + vector in parallel and fuses with Reciprocal Rank Fusion
(`1/(k+rank)`, no score normalization needed), then per-page dedup, then
rerank, then token budget. This is a clear retrieval-quality upgrade for the
memo explorer and for Ariadne retrieval. Reframed access treatment is the whole
point: the accessible-stream-id predicate must be pushed into **both** inner
scans (the keyword CTE and the vector CTE) _before_ RRF. gbrain's two-stage CTE
trick (inner CTE ordered by `embedding <=> vec` so the HNSW index stays usable,
outer CTE re-ranks) is exactly the structure to copy, with Threa's access
predicate added to the inner CTE. Filtering after fusion is a §3.1 leak. The
optional LLM multi-query expansion must go through `createAI` (INV-28) with
telemetry (INV-19) and must sanitize the query before it reaches the model
(prompt-injection channel), exactly as gbrain separates the raw query from the
sanitized expansion copy.

**B2. Source-boost ranking — Adapt.**
gbrain multiplies relevance by a slug-prefix factor (curated content up,
bulk/low-signal content down) via a longest-prefix SQL `CASE`. The mechanism is
sound; the _content_ of the boost map is one owner's taxonomy and taste. Threa
has no per-owner taxonomy. Reframe the factor as **structural, not editorial**:
boost by memo type and stream type (e.g. decisions and procedures above daily
chatter), defined per workspace, not per person. Keep the longest-prefix SQL
`CASE` shape and keep gbrain's "high-detail/temporal queries bypass the boost"
escape hatch so recency queries still surface recent chatter. The boost is
applied in the outer CTE after the inner access-scoped scan, never before it.

**B3. Reranking (best-effort, fail-open) — Adopt.**
gbrain treats the cross-encoder reranker as a pure enhancer: fixed timeout,
**fail-open on every failure reason** (returns the pre-rerank order unchanged),
and appends the un-reranked tail to protect recall instead of truncating. Adopt
the _posture_ exactly: rerank is never a dependency, never blocks results, and
must go through `createAI` (INV-28) with telemetry (INV-19), not a raw HTTP
client. The reranker only ever sees rows that already passed the §3.1
access-scoped scan, so it cannot reorder a private row into view. Gate it to a
cost tier (B7) so it runs only where the plan allows.

**B4. Query intent classification — Adopt.**
A cheap deterministic classifier (entity / temporal / event / general) that
picks a `detail` level which then reconfigures the ranking stack (e.g. disables
the structural boost for temporal queries). Identity-agnostic, no access
implications, high leverage: one switch tunes the whole pipeline per query
shape. Adopt; keep it deterministic/cheap (or a single small model call via
`createAI` with telemetry).

**B5. Anomaly detection (cohort z-score) — Defer.**
"What's unusual today" via per-cohort sample-stddev with careful zero-variance
and cold-start handling. Mechanically clean. Access reframing is heavy: cohorts
and baselines must be computed **per accessible scope** or restricted to the
public tier (§3.5), or a spike in a private channel leaks via the anomaly feed.
Useful later as a workspace-public signal; defer until the retrieval core
exists.

**B6. Orphans — Defer.**
Pages with zero inbound links, as a curation surface. In Threa, orphan-ness must
be computed within the viewer's accessible set (a memo may be "linked" only from
content the viewer cannot see, so global orphan-ness leaks structure). Low-risk,
low-priority curation tool once a memo link graph exists (depends on A1).

**B7. Search modes + cost model — Adapt.**
gbrain bundles correlated knobs (token budget, expansion on/off, search limit)
behind one `mode` key (conservative/balanced/tokenmax) and keys its query cache
on a `knobs_hash` so a tokenmax write cannot be served to a conservative read.
Adopt the bundle-behind-one-key idea and tie the tiers to Threa's plan
(free/pro/max) so retrieval cost tracks billing. **Critical reframing of the
cache key**: gbrain keys the cache on `source_id + knobs_hash`; Threa must key
it on `workspace_id + knobs_hash + a hash of the viewer's accessible-stream-id
set`. Without the access-scope component, a cached result computed for one
member is served to another with different stream access — a §3.5 leak. This
is the single most important correctness note in the retrieval cluster.

### C. Maintenance & synthesis

**C1. Dream / maintenance cycle — Adapt.**
A scheduled, idempotent, resumable batch pipeline whose phases run in causal
order (lint → backlinks → sync → synthesize → extract → patterns → recompute
weights → embed → orphans), coordinated by a DB lock. Threa already has the
substrate: the job queue + outbox dispatcher. Reframe as a **per-workspace**
scheduled maintenance job (not one global lock). The maintenance worker runs as
a privileged system actor over the full workspace corpus _at the data layer_ —
that is fine and necessary — but every artifact it _writes_ inherits
most-restrictive scope from its sources (§3.4), and every artifact it _exposes
to a user_ goes back through viewer access (§3.2). Phase ordering and
idempotency keys port directly. This is the umbrella that C2/C3 and B-cluster
recompute steps hang off.

**C2. Synthesize phase (transcript → brain) — Adapt.**
Two-tier model routing — a cheap significance verdict (cached by content hash so
backfills do not re-judge), then an expensive synthesizer subagent scoped by an
allow-list of slug prefixes. Threa's GAM classifier→memorizer is already this
two-tier shape; the portable additions are (a) the **content-hash-keyed verdict
cache** so reprocessing/backfill never re-pays the cheap judge, and (b)
**deterministic, hash-seeded chunking** of oversized inputs so a retry produces
identical chunks. Access reframing: the synthesizer's write scope is not a
namespace allow-list (gbrain's single-owner convention) but the
most-restrictive source scope (§3.4); a self-consumption guard (do not re-ingest
synthesized memos) maps to a memo-origin flag.

**C3. Patterns phase (cross-session theme detection) — Adapt, with care.**
gbrain names a recurring theme only when ≥ N reflections support it (an
evidence-threshold gate that turns a soft "I noticed a theme" into a falsifiable
minimum-support claim). The evidence-threshold gate is worth adopting. The
multiplayer reframing is significant and sensitive: gbrain's patterns are about
_one person's_ behavior across their own sessions. In a team, cross-member
behavioral pattern detection is a surveillance surface and a leak surface
(patterns inferred from private streams must not surface in shared ones).
Restrict v1 to **topic/decision patterns within a single accessible scope**,
not person-behavior patterns across members. Defer cross-member patterns until
there is an explicit, consented product decision.

### D. Epistemic layers

**D1. Takes vs facts (two epistemic layers) — Adapt.**
gbrain separates _takes_ (attributed beliefs: holder, kind, confidence weight,
time; multi-holder; cold storage) from _facts_ (the owner's hot personal
memory), with a one-way consolidate bridge and a strict "holder ≠ subject,
amplification ≠ endorsement, self-reported ≠ verified" attribution discipline.
The attributed-belief layer maps _beautifully_ onto multiplayer: `holder` is a
Threa user (or persona, or "workspace consensus"), `subject` is an entity, and
multi-holder disagreement is the normal team state rather than an anomaly. This
is a strong fit and a natural extension of the flat memo. The "facts" hot-memory
layer is explicitly single-owner; in Threa it would be per-user hot memory
(scratchpad-scoped), which is lower priority. Access reframing: a take is
visible only where its source stream is visible (§3.1); a take attributed to
member X derived from a private channel must not surface to members not in that
channel even though it is "about" a public entity. Adopt the attributed-belief
model as a memo enrichment; defer per-user hot facts.

**D2. Emotional weight scoring — Adapt (de-personalize).**
A deterministic 0..1 affect proxy (tag-emotion + take density + take weight +
owner-holder ratio) folded into ranking, computed in a batch CTE that avoids the
page×tags×takes Cartesian blowup. The batch-CTE shape is worth copying. The
_signal_ is explicitly one owner's affect (owner-holder ratio, a default
holder, an anglocentric seed tag list) — ranking a whole team's memory by one
person's feelings is wrong and is a §3.5 leak (it encodes who-felt-what).
Reframe the signal as **engagement over accessible streams only**: reactions,
replies, revisits, mention density — observable team signal, not inferred
affect, computed per accessible scope. Lower priority than the B-cluster.

**D3. Salience ranking — Adapt.**
Compact closed-form blend of importance × activity × recency
(`emotional_weight×5 + ln(1+takes) + 1/(1+days)`). Inherits D2's
de-personalization: replace the affect term with the engagement signal, compute
the activity term over the viewer's accessible set only, keep the explainable
closed form. Drives "recent/high-signal accessible memos" as the memo
explorer's default empty-query view (which `workspace-memory-explorer.md`
already calls for). Adopt the form once D2 is reframed.

**D4. Contradictions detection + auto-supersession — Adapt, never auto-apply.**
gbrain samples result pairs, runs a date pre-filter, judges with a confidence
floor, gates decisions on a Wilson-CI lower bound, and can auto-supersede the
losing claim. The statistical rigor (Wilson CI lower bound, sample-size notes,
prompt-version-keyed judgment cache) is excellent and portable. **The
auto-supersession is dangerous in multiplayer and must be rejected as an
automatic action.** Two members stating different things is frequently
legitimate disagreement, not an error with a correct winner; auto-supersession
also implies a cross-source write that violates §3.4 (it can erase a claim
whose source the deciding context could not even see). Reframe as a **read-only
"possible contradiction" surface** that proposes, never applies; supersession
stays a human action (or strictly within a single attributed source, never
across authors/streams). gbrain itself classifies its contradiction probe as
read-scope and keeps it out of the autonomous allow-list — Threa should hold the
same line and go further by removing auto-apply entirely.

### E. Discovery surfaces

**E1. whoknows (expertise / relationship-proximity routing) — Adapt, strong
access caveat.** "Who knows about X", scored by topical match × recency ×
salience, filtered to person/company entities in SQL. Genuinely valuable for a
team product ("who should I ask about the billing migration"). But expertise is
the highest-leak discovery surface: routing "Alice knows about Project X"
reveals both that Project X exists and that Alice worked on it, and if that
knowledge was built in a private channel the asker is not in, the answer leaks
the channel's existence and Alice's involvement. Hard reframing: expertise
edges may only be **derived from, and surfaced through, streams the asker can
access** (§3.1, viewer scope) — never the global corpus. An expert suggestion
must be reconstructable from sources the asker could open themselves. With that
constraint it is a strong feature; without it, it is a privacy incident
generator. Defer until viewer-scoped retrieval (B-cluster) is solid, then build
on top of it.

### F. Trust, identity & access

**F1. Trust boundary / source isolation / scopes / federated read — Adopt the
posture (hardening).** This is gbrain's least single-user subsystem and the most
directly relevant. The transferable principles, described functionally: (a) make
"is this caller untrusted/remote" a **required, typed, fail-closed** input on
the operations that cross Threa's untrusted boundary (public API, MCP/agent
surfaces), not an optional flag that defaults open — this aligns with INV-11
(fail loudly, no silent fallback); (b) apply the access predicate as a
**required non-defaulting parameter** at the serialization boundary, so a memo/
message rendered to an external caller carries content only from streams in the
caller's resolved scope. gbrain's own design notes cite an incident where a
coarse scope permitted an action outside the intended boundary, and the fix was
to make the trust context a required typed field rather than an inferred
default; Threa should adopt that "required, fail-closed, typed" discipline on
its boundary surfaces. Threa already has the conceptual pieces (workspace shard
INV-8, `checkStreamAccess`, the agent-vs-user split); this is about making the
_untrusted-boundary_ parameter non-optional and audited, not a new model.

**F2. Identity & access configuration (ACCESS_POLICY tiers / soul-audit) —
Adopt the UX nugget only.** gbrain authors access as a conversational tiered
markdown document the agent is _asked_ to respect. For Threa this is the wrong
layer — access is enforced in code, not honored from prose. The one portable
nugget is the _scope-comprehension UX_: a human-legible explanation of **why** a
given memo is or is not visible ("visible to you because it came from a public
channel" / "thread memos inherit access from their root stream"), which
`workspace-memory-explorer.md` already calls for. Adopt as explainer UX; reject
as a permission model.

### G. Eval discipline

**G1. Capture / replay / regression-alarm / hermeticity — Adopt (high value,
low risk).** gbrain captures real query/search ops (off by default, PII
scrubbed), replays them against a new build, and reports set-Jaccard@k, top-1
stability, and latency Δ as **regression alarms, not hash pass/fail**, with the
eval harness hermetically sealed from the real brain (in-memory DB, truncated
between cases). Threa already mandates eval calling production entry points with
colocated config (INV-44/45). The portable additions: (a) capture must be
PII-scrubbed **and access-scope-tagged**, run only against synthetic workspaces,
never a real one (hermeticity becomes a privacy requirement, not just a
correctness one); (b) replay as a drift alarm with documented healthy bands is
the right gate for the B-cluster retrieval changes — adopting hybrid search,
RRF, and rerank without this is shipping retrieval changes blind. Build the
eval harness alongside the retrieval work, not after.

### H. Chunking & code graph

**H1. Versioned chunking with hash-folded invalidation — Adopt.**
Folding a `CHUNKER_VERSION` into each item's content hash so a chunker-shape
change forces a clean re-embed on next sync is a clean correctness mechanism.
Threa embeds memos; today there is no version pin, so a chunking/embedding
change silently leaves a mixed corpus. Identity-agnostic, no access
implications, safe to adopt. Chunk-grain FTS (rank doc-comment/structured fields
above body) is a small relevance win for memo full-text search.

**H2. Code knowledge graph (tree-sitter call/inheritance edges) — Reject for
the memory system.** Threa's memory domain is conversational knowledge, not
source code. Not relevant to GAM. (Potentially interesting elsewhere in Threa
someday, out of scope here.)

### I. Cross-cutting philosophy

**I1. Thin harness / fat skills; latent-vs-deterministic; diarization;
knowledge runtime — Adopt as design principles.** Not features; design
discipline that should shape the B/C-cluster work: the model decides _what_
(judgment — is this worth remembering, which claims contradict), deterministic
code guarantees _where/how_ (the access predicate, the SQL ranking, the scope
inheritance). The §3 spine is exactly an application of "never put the
access boundary in latent space" — the model never decides who can see a memo;
SQL does. "Diarization" (read many, emit one structured judgment) is precisely
what the memorizer and a future synthesize phase do. Worth stating explicitly in
the memory system's design docs so future contributors do not drift access or
ranking decisions into prompts.

---

## 5. Is GAM still the answer?

Direct answer to the framing question ("while GAM is the core, we don't have to
stay there; if GAM is not the answer, so be it"):

**Keep GAM as the ingestion core. It is not the bottleneck and it is the part
that is already multiplayer- and access-correct.** GAM's conversation-boundary
extraction, debounced per-stream accumulation, two-tier classify→memorize, and
embedding pipeline are sound and, importantly, derive access from source streams
by construction. Nothing in gbrain is a better _ingestion_ model for
multi-party chat — gbrain's ingestion assumes one owner's intentional corpus,
which is the exact assumption Threa's problem statement rejects.

gbrain's real value to Threa is **everything after ingestion**, where Threa is
currently thin:

1. Retrieval quality (B-cluster: hybrid + RRF + rerank + intent + modes) — the
   highest-leverage, most portable cluster. Biggest near-term win.
2. Eval discipline (G1) — the gate that makes (1) safe to ship.
3. Scheduled maintenance/synthesis (C-cluster) on the existing job/outbox
   substrate.
4. A richer epistemic memo shape (A1 compiled-truth/timeline; D1 attributed
   takes) — the one genuinely _architectural_ question gbrain raises, and the
   only place "moving beyond flat GAM memos" is warranted. This is an
   evolution of the memo, not a replacement of GAM.

So: not "replace GAM", but "GAM ingests; adopt gbrain's retrieval + eval layers;
spike the epistemic-model evolution". If a future spike on A1 shows the
compiled-truth/timeline model clearly beats flat memos on multi-party recall,
that is where the memo model evolves — with the §3.4 most-restrictive
inheritance rule making it safe.

---

## 6. Suggested roadmap

Each tier states its access-control acceptance criteria and the invariants it
must respect. Nothing here is committed; this is a recommended sequence.

### Tier 1 — Retrieval core + eval gate (highest leverage)

- B1 hybrid search + RRF, B4 intent classifier, B2 structural boost, B3
  fail-open rerank, B7 mode bundles.
- G1 eval harness (capture/replay/regression alarms) built **alongside**, not
  after — it is the gate that proves the retrieval change is not a regression.
- Access acceptance criteria: the accessible-stream-id predicate is in the
  **inner** keyword and vector CTEs (§3.1); the query cache key includes a hash
  of the viewer's accessible-stream set (§3.5, B7); user surfaces use viewer
  access, agent retrieval uses agent-invocation access (§3.2). Through
  `createAI` with telemetry for any model call (INV-28, INV-19); inputs Zod-
  validated (INV-55); colocated in `features/memos/` (INV-51).

### Tier 2 — Maintenance substrate + epistemic enrichment

- C1 per-workspace maintenance job on the outbox/job-queue substrate; C2
  verdict-cache + deterministic chunking; H1 versioned chunking.
- D1 attributed-takes enrichment; D3 salience (de-personalized per D2) to power
  the explorer's default view.
- Access acceptance criteria: every synthesized/written artifact stamps
  most-restrictive source scope (§3.4); maintenance reads as a system actor but
  exposes through viewer access (§3.2); outbox + projection written in one
  transaction (INV-4, INV-7); race-safe writes (INV-20).

### Tier 3 — Epistemic-model spike + sensitive discovery

- A1 compiled-truth/timeline memo shape — a dedicated design spike with the
  traceability invariant reframed as a security invariant (no synthesized claim
  without an accessible source behind it).
- D4 contradiction surface (read-only, propose-never-apply); E1 whoknows
  (viewer-scoped only); B5 anomaly / B6 orphans as workspace-public or
  accessible-scope curation tools.
- Access acceptance criteria: per-hop re-filtering on every traversal (§3.3);
  no auto-supersession across authors/streams (§3.4, D4); expertise edges
  reconstructable from the asker's own accessible sources (E1).

### Continuous — posture & discipline

- F1 required/typed/fail-closed untrusted-boundary parameter (INV-11); A3 "no
  cross-boundary join, reachable ≠ accessible" as a review checklist item for
  every new query path; F2 scope-comprehension explainer UX; I1 design
  principles written into the memory docs.

---

## 7. Risks, non-goals, open questions

Risks:

- The dominant risk in every adopted concept is the same: an access filter that
  is a post-filter instead of an inner predicate, or a shared precompute/cache
  that is not scope-keyed. §3 exists to make this a single reviewable
  checklist, not a per-feature judgment call.
- Synthesis-as-laundering (§3.4) is the subtle one: it passes naive review
  because each input is individually legitimate. Most-restrictive inheritance
  must be a hard, tested invariant on any write path, not a convention.
- Documentation drift already exists in this area (`docs/core-concepts.md`
  states the classifier/memorizer use Haiku/Sonnet; the code uses a different
  configured model). Any roadmap work here should also true up that doc so
  future contributors are not misled. Use only models from
  `docs/model-reference.md` (INV-16).

Non-goals:

- No cross-workspace memory (INV-8 is absolute).
- No new visibility/permission semantics for memos
  (`workspace-memory-explorer.md` non-goal; access derives from source streams,
  full stop).
- No automatic cross-author memo supersession.
- No cross-member behavioral pattern detection without an explicit consented
  product decision.
- Not vendoring gbrain code; this is concept transfer only.

Open questions for product/eng:

- A1: is the compiled-truth/timeline shape worth the migration, or do attributed
  takes (D1) on flat memos capture most of the value at a fraction of the cost?
- B7/§3.5: accessible-scope cache keys are correct but can fragment the cache
  badly in large workspaces with many distinct membership sets — is a coarse
  public/private partition an acceptable first cut, accepting lower hit rates on
  private content?
- E1: is viewer-scoped expertise routing useful enough, or does scoping it
  correctly remove most of its value (the most useful expert is often behind a
  wall the asker cannot see)? Possibly a "request an intro" pattern instead of a
  direct answer.
