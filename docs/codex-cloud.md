# Codex cloud setup

This repo already includes a Claude-oriented web bootstrap. This companion setup gives Codex a predictable cloud sandbox flow too.

## Quick start

Use this for the Codex environment setup script:

```bash
bash scripts/codex-cloud-setup.sh
```

Use this for the Codex environment maintenance script:

```bash
bash scripts/codex-cloud-maintenance.sh
```

The setup script will:

1. copy `.env.remote-dev` into `.env`
2. skip local Docker startup in Codex Cloud
3. reinstall workspace dependencies with Bun

The maintenance script will:

1. refresh `.env` from `.env.remote-dev`
2. keep Docker-backed services out of scope for Codex Cloud
3. resync dependencies with Bun without doing the full fresh-container bootstrap

Then verify the environment:

```bash
bash scripts/codex-cloud-doctor.sh
```

The doctor exits non-zero when the Codex Cloud prerequisites fail and reminds you that Docker-backed flows stay in CI for now.

When the checks look good, run the commands relevant to your task:

```bash
bun run lint
bun run typecheck
```

## Notes for cloud sandboxes

- The scripts are intentionally idempotent enough for disposable environments.
- Codex Cloud does not try to start Docker for local Postgres/MinIO. Use CI for Docker-backed tests and flows.
- This repo is Bun-first, so the Codex scripts require `bun` instead of falling back to other package managers.
- `.env.remote-dev` is the single shared env template used by both the Codex and Claude remote-dev flows.
