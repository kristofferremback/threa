# Tasks

Work items broken into separate PRs for better checkpoints.

## Status

| Task | Status | PR |
|------|--------|-----|
| [001: Multi-Listener Outbox](./001-outbox-multi-listener.md) | In Progress | #6 |
| [002: Agentic Companion](./002-agentic-companion.md) | Planning | - |

## Deferred Items (PR Review Feedback)

Items identified during PR #6 review but deferred for later:

1. **More stream-related events** (Severity 2) - Add more stream event types as needed
2. **Local testing strategy revision** (Severity 2) - Improve test isolation to prevent data pollution between tests

## Dependencies

```
001-outbox-multi-listener
         │
         ▼
002-agentic-companion
```

Task 002 depends on 001 being complete.

## Reference

- [PR #5](https://github.com/kristofferremback/threa/pull/5) - Closed, kept as reference for what NOT to do
- [Legacy Exploration](../docs/legacy-exploration.md) - Architecture decisions, especially "Streaming & Recovery"
