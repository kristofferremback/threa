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

1. copy `.env.codex-cloud` into `.env`
2. start Docker with the sandbox proxy env when the sandbox exposes `dockerd`
3. start the local compose services and wait for them to become healthy
4. reinstall workspace dependencies with Bun

The maintenance script will:

1. refresh `.env` from `.env.codex-cloud`
2. ensure local compose services are running after cache resume or branch checkout
3. resync dependencies with Bun without doing the full fresh-container bootstrap

Then verify the environment:

```bash
bash scripts/codex-cloud-doctor.sh
```

The doctor exits non-zero when a required check fails and prints the failing command output so the broken dependency is visible.

When the checks look good, start development as usual:

```bash
bun run dev
```

## Notes for cloud sandboxes

- The scripts are intentionally idempotent enough for disposable environments.
- Docker startup is best-effort because some hosted sandboxes do not expose a daemon.
- This repo is Bun-first, so the Codex scripts require `bun` instead of falling back to other package managers.
- `.env.codex-cloud` mirrors the same local-development values used by the Claude web setup so Codex and Claude can target the same stack.
