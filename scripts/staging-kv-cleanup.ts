/**
 * One-time cleanup of orphaned workspace_id → region mappings in the staging
 * workspace-router KV namespace.
 *
 * History: scripts/staging-pr.ts used to write `workspaceId → pr-N` into KV on
 * every PR deploy. Because all PRs clone staging_main and inherit the same
 * workspace IDs, each deploy overwrote the previous mapping. The "stable" main
 * staging route via staging.threa.io ended up pointing at whichever PR backend
 * was deployed last (and at nothing after teardown).
 *
 * The worker now derives the region from the request's hostname for all staging
 * traffic, so the workspace-id KV keys are dead weight. This script lists every
 * key with the `ws_` prefix and deletes it. The `__regions_config__` key (and
 * any other infra keys) is left untouched.
 *
 * Usage:
 *   STAGING_KV_NAMESPACE_ID=... \
 *   CLOUDFLARE_ACCOUNT_ID=... \
 *   CLOUDFLARE_API_TOKEN=... \
 *   bun scripts/staging-kv-cleanup.ts [--dry-run]
 */

import { parseArgs } from "util"

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "dry-run": { type: "boolean", default: false },
  },
})
const dryRun = values["dry-run"] ?? false

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
  return val
}

const CLOUDFLARE_ACCOUNT_ID = requireEnv("CLOUDFLARE_ACCOUNT_ID")
const CLOUDFLARE_API_TOKEN = requireEnv("CLOUDFLARE_API_TOKEN")
const STAGING_KV_NAMESPACE_ID = requireEnv("STAGING_KV_NAMESPACE_ID")

const CF_KV_BASE = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${STAGING_KV_NAMESPACE_ID}`

interface KvListResponse {
  result: { name: string }[]
  result_info?: { cursor?: string }
  success: boolean
  errors?: { message: string }[]
}

async function listKvKeys(prefix: string): Promise<string[]> {
  const names: string[] = []
  let cursor: string | undefined
  do {
    const params = new URLSearchParams({ prefix, limit: "1000" })
    if (cursor) params.set("cursor", cursor)
    const res = await fetch(`${CF_KV_BASE}/keys?${params}`, {
      headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
    })
    if (!res.ok) throw new Error(`KV list failed: ${await res.text()}`)
    const data = (await res.json()) as KvListResponse
    if (!data.success) throw new Error(`KV list failed: ${JSON.stringify(data.errors)}`)
    for (const k of data.result) names.push(k.name)
    cursor = data.result_info?.cursor
  } while (cursor)
  return names
}

async function bulkDelete(keys: string[]): Promise<void> {
  // CF KV bulk delete tops out at 10k keys per request — our orphaned set is
  // well under that, but chunk anyway to keep the script honest.
  const CHUNK = 1000
  for (let i = 0; i < keys.length; i += CHUNK) {
    const batch = keys.slice(i, i + CHUNK)
    const res = await fetch(`${CF_KV_BASE}/bulk/delete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(batch),
    })
    if (!res.ok) throw new Error(`KV bulk delete failed: ${await res.text()}`)
    console.log(`Deleted ${batch.length} keys (batch ${i / CHUNK + 1})`)
  }
}

async function main(): Promise<void> {
  console.log(`Listing workspace_id keys (prefix: ws_)...`)
  const keys = await listKvKeys("ws_")

  if (keys.length === 0) {
    console.log("No orphaned workspace_id keys found")
    return
  }

  console.log(`Found ${keys.length} orphaned workspace_id keys:`)
  for (const k of keys) console.log(`  ${k}`)

  if (dryRun) {
    console.log("\n--dry-run: not deleting")
    return
  }

  await bulkDelete(keys)
  console.log(`\nDone — deleted ${keys.length} keys`)
}

main().catch((err) => {
  console.error("Cleanup failed:", err)
  process.exit(1)
})
