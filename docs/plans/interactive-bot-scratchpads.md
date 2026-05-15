# Interactive bot scratchpads

## Problem

Threa's scratchpad experience currently treats Ariadne as a special active companion: when companion mode is enabled, she responds automatically as part of the scratchpad flow. That works for the built-in assistant, but it does not generalize cleanly to personal bots such as Hermes, OpenClaw, NanoClaw, or local developer agents.

Personal bots now have the backend foundation to be user-owned and tagged with traits such as `interactive`, but Threa does not yet have a provider-agnostic product model for starting a scratchpad with one of those bots and routing invocations to the appropriate runtime on the other side.

The missing concept is an interactive bot scratchpad where Threa owns the conversation and permissions, while the actual bot runtime may be Ariadne, a local Pi/OpenClaw process, Hermes, or another adapter.

## Direction

Extend scratchpads so they can include one or more passive interactive bots. A bot with the `interactive` trait can be selected when creating a scratchpad. From Threa's perspective, the bot is a member of the scratchpad, but it is passive by default and only responds when invoked, for example by mentioning `@ariadne` or `@openclaw`.

This makes Ariadne one implementation of the same interactive-bot participant model rather than a scratchpad-specific special case.

## How it could work

```text
User creates scratchpad with an interactive bot
  ↓
Threa records the bot as a scratchpad participant/member
  ↓
User sends a message mentioning @bot
  ↓
Threa emits a provider-agnostic bot invocation
  ↓
The matching bot runtime claims/processes the invocation
  ↓
Runtime posts progress/final responses back as the bot
```

For local agents, the runtime might be a long-running bridge process on the user's machine. That bridge would map Threa scratchpads to local runtime sessions and decide whether to reuse an existing process, spawn a new process, or create a worktree.

## Key design principles

**1. Provider-agnostic Threa model**

Threa should not know whether a bot is backed by Ariadne, Hermes, OpenClaw, Pi, or another runtime. It should model bot membership, invocations, permissions, and messages. Runtime-specific concerns stay behind adapters.

**2. Passive by default**

Interactive bots should not automatically respond to every scratchpad message. They become passive participants and respond only when invoked by mention or another explicit trigger. This avoids noisy multi-bot conversations and gives users control.

**3. Runtime session binding**

The runtime side likely needs a binding between a Threa scratchpad and a local/provider session:

```text
workspaceId + scratchpadId + botId → runtimeSessionId
```

For a local coding bot, that binding might include a Pi session file, working directory, optional git worktree, model/provider config, and live process/socket state.

**4. Local runtime owns process/worktree policy**

Whether a bot creates a worktree, reuses the current checkout, spawns a process per task, or maintains a daemon is runtime-specific. Threa should not encode those policies in the core scratchpad model.

**5. Safe claiming and deduplication**

If multiple runtimes can service the same bot, invocations need a claim/dedup mechanism so only one runtime handles a given message. The initial local prototype can use polling and conservative message metadata, but a first-class invocation/claim API may be needed.

## Open questions

- Is one Threa scratchpad mapped to one runtime session, or can multiple local sessions exist per scratchpad?
- Should creating a scratchpad with a local coding bot automatically create a git worktree, or should that be opt-in per bot/runtime?
- Should bot invocations be represented as ordinary messages plus metadata, or as a first-class invocation resource?
- How should users target a specific runtime instance when multiple machines are online?
- Should Ariadne continue to support an auto-reply mode, or should she become mention-only in scratchpads too?
- What is the minimum realtime surface needed: polling public API, Socket.io, SSE, or a dedicated bot-runtime event stream?

## Non-goals for this note

- No implementation in this PR.
- No schema or API changes yet.
- No frontend UI changes yet.
- No decision on the local process/worktree model yet.

## Suggested next step

Prototype the product semantics first: allow scratchpads to include an `interactive` bot participant and invoke that bot explicitly via mention. Once the Threa-side semantics are clear, define the runtime adapter contract for local Pi/OpenClaw/Hermes-style integrations.
