---
name: sync-frontend-design
description: Update the vendored `frontend-design` skill in `.agents/skills/frontend-design/` from upstream `anthropics/skills` on GitHub. Use when the user asks to "sync frontend-design", "update the frontend-design skill", or "pull the latest frontend-design from GitHub".
---

# Sync frontend-design from upstream

The `frontend-design` skill in this repo is vendored from https://github.com/anthropics/skills (path: `skills/frontend-design/`). This skill refreshes the local copy.

## Steps

1. Fetch the upstream `SKILL.md` and `LICENSE.txt` from the `main` branch:

   ```bash
   curl -fsSL -o .agents/skills/frontend-design/SKILL.md \
     https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md
   curl -fsSL -o .agents/skills/frontend-design/LICENSE.txt \
     https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/LICENSE.txt
   ```

2. Show `git diff -- .agents/skills/frontend-design/` so the user can review what changed.

3. If there are no changes, report that and stop.

4. If there are changes, ask the user whether to commit. On approval, commit with message `chore: sync frontend-design skill from anthropics/skills`.

## Notes

- The upstream repo may add additional files (e.g. references, scripts) over time. If `curl` against a new file path 404s, check the upstream tree at https://github.com/anthropics/skills/tree/main/skills/frontend-design and add it to the fetch list.
- Do not edit the vendored files locally — local edits will be overwritten on next sync. If a project-specific override is needed, fork the skill under a new name.
