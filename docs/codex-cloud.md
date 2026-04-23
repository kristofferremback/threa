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
2. start Docker if the sandbox exposes `dockerd`
3. start the local compose services
4. reinstall workspace dependencies

The maintenance script will:

1. refresh `.env` from `.env.codex-cloud`
2. ensure local compose services are running after cache resume or branch checkout
3. resync dependencies without doing the full fresh-container bootstrap

Then verify the environment:

```bash
bash scripts/codex-cloud-doctor.sh
```

When the checks look good, start development as usual:

```bash
bun run dev
```

## Notes for cloud sandboxes

- The scripts are intentionally idempotent enough for disposable environments.
- Docker startup is best-effort because some hosted sandboxes do not expose a daemon.
- `.env.codex-cloud` mirrors the same local-development values used by the Claude web setup so Codex and Claude can target the same stack.
