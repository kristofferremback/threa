# Tasks

Work items broken into separate PRs for better checkpoints.

## Status

| Task | Status | PR |
|------|--------|-----|
| [001: Multi-Listener Outbox](./001-outbox-multi-listener.md) | Complete | #6 |
| [002: Agentic Companion](./002-agentic-companion.md) | In Progress | #10 |
| [003: Stream Context Enrichment](./003-stream-context-enrichment.md) | Planning | - |
| [004: Agent Message Tool](./004-agent-message-tool.md) | Planning | - |

## Deferred Items (PR Review Feedback)

Items identified during PR #6 review but deferred for later:

1. **More stream-related events** (Severity 2) - Add more stream event types as needed
2. **Local testing strategy revision** (Severity 2) - Improve test isolation to prevent data pollution between tests
3. **More broadcast room types** (Severity 2) - Add workspace-scoped rooms for app harness events (users added, channels pinned, mentions, etc.)

## Dependencies

```
001-outbox-multi-listener
         │
         ▼
002-agentic-companion
         │
         ├─────────────────┐
         ▼                 ▼
003-stream-context    004-agent-message-tool
```

Task 002 depends on 001 being complete.
Tasks 003 and 004 depend on 002 (specifically the thin worker / agent module refactor).

## Reference

- [PR #5](https://github.com/kristofferremback/threa/pull/5) - Closed, kept as reference for what NOT to do
- [PR #10 Work Notes](../docs/plans/agentic-companion/work_notes.md) - Session log for task 002
- [Legacy Exploration](../docs/legacy-exploration.md) - Architecture decisions, especially "Streaming & Recovery"
