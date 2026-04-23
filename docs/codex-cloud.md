# Codex cloud setup

This repo already includes a Claude-oriented web bootstrap. This companion setup gives Codex a predictable cloud sandbox flow too.

## Quick start

Run the bootstrap script from the repo root:

```bash
bash scripts/codex-cloud-setup.sh
```

That script will:

1. copy `.env.codex-cloud` into `.env`
2. start Docker if the sandbox exposes `dockerd`
3. start the local compose services
4. reinstall workspace dependencies

Then verify the environment:

```bash
bash scripts/codex-cloud-doctor.sh
```

When the checks look good, start development as usual:

```bash
bun run dev
```

## Notes for cloud sandboxes

- The script is intentionally idempotent enough for disposable environments.
- Docker startup is best-effort because some hosted sandboxes do not expose a daemon.
- `.env.codex-cloud` mirrors the same local-development values used by the Claude web setup so Codex and Claude can target the same stack.
