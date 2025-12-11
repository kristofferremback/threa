# Tasks

Work items broken into separate PRs for better checkpoints.

## Status

| Task | Status | PR |
|------|--------|-----|
| [001: Multi-Listener Outbox](./001-outbox-multi-listener.md) | In Progress | - |
| [002: Agentic Companion](./002-agentic-companion.md) | Planning | - |

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
