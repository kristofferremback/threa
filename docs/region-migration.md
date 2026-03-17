# Region Migration Design Sketch

How workspace migration between regions would work if needed. This is a design sketch, not a runbook — no tooling exists yet.

## Why migrate

- Data residency requirements change (e.g. a team moves from EU to US, or a new regulation applies)
- Latency — workspace creator picked a distant region
- Compliance — organizational policy mandates a specific region

## Data to move

All workspace-scoped data lives in three stores:

1. **PostgreSQL** — all rows with the workspace's `workspace_id` across every table (messages, streams, events, users, personas, etc.)
2. **S3** — file uploads in the regional bucket under the workspace prefix
3. **Cloudflare KV** — the `workspace:<slug>` → `{ region, workspaceId }` routing entry

## Approach

Export/import with a workspace write-lock:

1. **Pause workspace** — set a maintenance flag in the control plane; the workspace router returns 503 for the workspace. Connected clients see a "migrating" state.
2. **Dump workspace data** — export all workspace-scoped rows from the source region's PostgreSQL. Use `COPY` or `pg_dump` with a workspace filter.
3. **Transfer S3 objects** — copy the workspace prefix from the source bucket to the target region's bucket.
4. **Import to target region** — load the PostgreSQL dump into the target region's database. Verify row counts match.
5. **Update routing** — update the control plane's workspace record with the new region, then update the Cloudflare KV entry so the workspace router sends traffic to the new region.
6. **Resume workspace** — clear the maintenance flag. Clients reconnect via the workspace router, which now routes to the new region.
7. **Cleanup** — after a verification period, delete source data (PostgreSQL rows, S3 objects).

## Risks

- **Downtime** — workspace is unavailable during migration. Duration depends on data volume.
- **Event ordering** — outbox events in flight during the pause could be lost. Drain the outbox before dumping.
- **Invitation shadows** — the control plane stores invitation records globally. These reference `workspace_id` and don't need to move, but the `region` field on the workspace record must be updated.
- **Socket reconnection** — clients will lose their WebSocket connection. The existing reconnect-and-rebootstrap flow handles this, but users will see a brief interruption.
- **Cross-references** — if any future feature stores cross-workspace references, those would break during migration. Currently all data is workspace-scoped so this is not an issue.

## Not in scope yet

- **Live migration** — zero-downtime migration with dual-write and cutover. Significantly more complex.
- **Automated tooling** — CLI or admin UI to trigger migration. Would need to orchestrate all the steps above.
- **Partial migration** — moving only some streams or data subsets. Not meaningful given the workspace-scoped data model.
