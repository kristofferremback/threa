# Codex + Claude Interop

Use this bridge file so Codex can reuse existing Claude assets with minimal duplication.

## Shared docs

- `CLAUDE.md` is the single source of truth for project invariants and coding rules.
- Do not duplicate invariants in `AGENTS.md`; keep them only in `CLAUDE.md`.
- Read project guidance from `CLAUDE.md` for coding tasks in this repo.
- Also read global guidance from `~/.claude/CLAUDE.md` when it exists.
- If guidance conflicts, prefer repo-local `CLAUDE.md` for project-specific behavior.

## Skills

- Store project skills in `.agents/skills`.
- Keep `.claude/skills` as a symlink to `.agents/skills` for Claude compatibility.
