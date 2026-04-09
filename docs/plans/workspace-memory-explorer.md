# Workspace Memory Explorer Plan

## Problem

`THR-35` currently frames the feature as a "knowledge explorer (graph view)". That skips the more immediate problem: memos already exist, but users cannot explicitly browse them as workspace memory.

This creates a product gap:

- Memos are generated and used indirectly by Ariadne, but remain invisible to users
- Users cannot directly inspect what the system believes is worth remembering
- Users cannot semantically search memos as memos
- Users cannot reliably trace a memo back to the exact message, stream, and root context that produced it
- A graph UI risks becoming a visualization-first feature before the underlying memory surface is useful

The first version of workspace memory exploration should therefore be a dedicated page for visible, searchable, scope-safe memos. Graph traversal is a follow-up visualization, not the initial definition of the feature.

## Goal

Create a first-class workspace memory page where users can:

- See memos they are allowed to access
- Search those memos semantically
- Filter and inspect them without invoking an agent
- Understand where each memo came from
- Navigate back to the source message and stream or root stream

This page makes workspace memory explicit. It does not replace Ariadne, and it does not require graph visualization in v1.

## Core Product Decision

Workspace memory exploration is not "a graph page". It is "a memo explorer page".

Graph view is one possible visualization after the explorer works as a useful standalone surface.

## Requirements

### R1: Access boundaries are identical to memo retrieval boundaries

Memos cannot escape their scope. The explorer must respect the same access guarantees as Ariadne retrieval.

Required rules:

- Personal scratchpad memos are only visible to their owner
- DM memos are only visible to DM participants
- Private channel memos are only visible to channel participants
- Public channel memos are visible workspace-wide
- Thread memos inherit visibility from their root stream

The explorer must not invent a broader workspace-level visibility concept for memos. "Workspace memory" means "all memory visible to the current viewer inside this workspace", not "all memos in the workspace database".

### R2: Dedicated page, not modal

The explorer needs its own route and page-level information architecture. A modal is too constrained for:

- search
- source inspection
- provenance breadcrumbs
- side-by-side exploration

Suggested route:

- `/w/:workspaceId/memory`

### R3: Semantic search is first-class

Memos are text. Users need to search them semantically, not just by exact keywords.

The page should support:

- semantic query input
- quoted exact phrase search matching message search semantics
- filters for stream, memo type, knowledge type, participant scope, tag, and time
- ranking that favors relevance but still exposes provenance clearly

Search behavior should be:

- unquoted query: semantic memo search
- quoted query: exact case-insensitive phrase match

### R4: Provenance must be explicit

Every memo shown in the explorer must answer:

- What is this memo about?
- What message or messages produced it?
- In which stream did this happen?
- If the source is a thread, what root stream does it belong to?
- Can I jump back to the original conversation?

Minimum provenance UI per memo:

- source stream label
- thread/root context when applicable
- source message count
- direct "open source" action
- direct "open exact message" action when a single anchor is available

### R5: AI traces must deep-link to memo views

Once memos become user-visible, trace sources that represent memo retrieval should link to the memo explorer, not merely back to the raw stream.

This is required so users can:

- inspect the exact memo Ariadne used
- verify its provenance from the memo detail view
- continue exploring related visible memos from that point

Implications:

- `workspace_memo` trace sources need a stable memo-level destination
- the trace UI should open the memo explorer with the referenced memo selected
- trace source metadata likely needs `memoId` in addition to stream metadata
- message-level trace sources should continue linking to exact messages in streams

## Proposed Page Structure

### 1. Search and Filters Header

Persistent top area with:

- semantic search box
- scope summary ("Showing memos you can access")
- filters: stream, type, tag, date, people
- sort: relevance, newest, updated

### 2. Memo Results Pane

Primary column showing memo cards or rows.

Each result should include:

- title
- abstract
- key points preview
- tags
- memo type and knowledge type
- source stream
- root stream when different
- created or updated time
- source message count

This pane answers: "What memories exist here?"

### 3. Memo Detail Pane

Selecting a memo opens a richer detail view with:

- full memo body
- provenance block
- list of source messages
- links back to source stream and exact message targets
- related memos by similarity or shared provenance

This pane answers: "Why does this memo exist, and where did it come from?"

## Interaction Model

### Default entry

When a user opens the page, show recent or high-signal accessible memos. Do not require a search before the page becomes useful.

### Search flow

1. User types a semantic question or topic
2. Explorer returns matching memos
3. User inspects memo details
4. User jumps back to source if needed

### Provenance flow

1. User opens memo
2. User sees source stream and exact anchor messages
3. User clicks through to `/w/:workspaceId/s/:streamId?m=:messageId`
4. If source was in a thread, UI also shows the root stream context

### Trace flow

1. Ariadne trace shows a `workspace_memo` source
2. User clicks the source from the trace UI
3. User lands in `/w/:workspaceId/memory` with that memo selected
4. User inspects memo details and provenance
5. User optionally jumps from the memo to the exact source stream or message

### Scope comprehension flow

Users should be able to understand why some memories are visible and others are not. The page should make the boundary legible without exposing hidden data.

Examples:

- "Visible to you from private scratchpads, DMs, private channels you are in, and public channels"
- "Thread memos inherit access from their root stream"

## Access Model

The backend already has the right conceptual foundation:

- user-visible search resolves accessible stream IDs first
- agent retrieval computes access based on invocation context
- thread access inherits from the root stream

The explorer should use viewer access, not agent invocation access.

That means:

- the page resolves the current user's accessible streams
- memo search is filtered to memos whose source stream is inside that accessible set
- thread memos are included or excluded based on root stream visibility

This keeps the memo explorer aligned with the existing security posture rather than creating a parallel access system.

## Search Model

The explorer should search memos directly, not only messages.

Recommended behavior:

- semantic memo search is the default path
- quoted query switches to exact case-insensitive phrase matching
- search results can be narrowed by stream filters derived from accessible streams
- empty query shows recent accessible memos instead of a blank state

This should mirror message search semantics so the user does not have to learn a separate search language for memos.

Important distinction:

- message search answers "where was this discussed?"
- memo search answers "what knowledge has been preserved?"

Both are useful, but the explorer page is centered on the second question.

## Provenance Contract

Each memo result should expose enough metadata to make source recovery trustworthy.

The explorer payload should include:

- memo id
- title
- abstract
- key points
- tags
- memo type
- knowledge type
- created at and updated at
- source message ids
- primary source message id when available
- source stream id, type, and name
- root stream id, type, and name when source stream is a thread
- participant summary when safe to show

This supports both direct navigation and user trust. If users cannot audit a memo's origin, the explorer will feel opaque.

For trace integration, memo-oriented source payloads should also include:

- memo id
- stable internal destination to the memo explorer selection state

## Non-Goals for V1

- Graph visualization of memo-to-memo relationships
- Inline ask mode or embedded scratchpad chat against memos
- Editing or curating memos manually
- Cross-workspace memory views
- New permission semantics
- Replacing Ariadne or Thinking Spaces

## Follow-Up Work

Once the memo explorer page is useful on its own, follow-up work can add:

- inline ask mode against the current visible memo set
- graph view as an alternate visualization
- richer memo-to-memo relationship edges
- saved views or topic collections
- memory health tooling such as stale, superseded, or low-confidence memo states

## Suggested Ticket Reframe

`THR-35` should describe the first deliverable as a workspace memory explorer page, not a graph-first feature.

Suggested scope for the ticket:

- create a dedicated workspace memory route
- show accessible memos in a list/detail explorer
- add semantic memo search and filters
- show provenance and source navigation
- ensure AI traces deep-link memo sources into the memo explorer

Suggested follow-up ticket:

- inline ask / embedded scratchpad for memo exploration
- visual graph view for memo relationships inside the explorer

## Why This Matters

The product promise is not just that Threa remembers. It is that users can inspect, trust, and use what Threa remembers.

Making memos visible is the first time workspace memory becomes a user-facing product surface instead of an invisible substrate behind Ariadne.
