/**
 * Sync WorkOS authorization config from code definitions.
 *
 * Reads API_KEY_PERMISSIONS from @threa/types and ensures they exist in WorkOS.
 * Creates missing permissions, updates name/description on existing ones.
 *
 * Usage:
 *   bun scripts/sync-workos-permissions.ts              # sync (create/update)
 *   bun scripts/sync-workos-permissions.ts --dry-run    # preview without changes
 *   bun scripts/sync-workos-permissions.ts --check      # check for drift, exit 1 if found
 *   WORKOS_API_KEY=sk_... bun scripts/sync-workos-permissions.ts
 */

import * as fs from "fs"
import * as path from "path"
import { API_KEY_PERMISSIONS } from "../packages/types/src"

const WORKOS_BASE = "https://api.workos.com"

// --- Config ---

function loadApiKey(): string {
  // Explicit env var takes precedence
  if (process.env.WORKOS_API_KEY) return process.env.WORKOS_API_KEY

  // Fall back to backend .env
  const envPath = path.resolve(import.meta.dir, "../apps/backend/.env")
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8")
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (trimmed.startsWith("WORKOS_API_KEY=")) {
        let value = trimmed.slice("WORKOS_API_KEY=".length)
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        return value
      }
    }
  }

  console.error("WORKOS_API_KEY not found. Set it as env var or in apps/backend/.env")
  process.exit(1)
}

// --- WorkOS API client ---

interface WorkOSPermission {
  id: string
  slug: string
  name: string
  description: string
  system: boolean
}

async function workosRequest<T>(apiKey: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${WORKOS_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`WorkOS ${method} ${path} → ${res.status}: ${text}`)
  }

  return res.json() as Promise<T>
}

async function listPermissions(apiKey: string): Promise<WorkOSPermission[]> {
  const data = await workosRequest<{ data: WorkOSPermission[] }>(apiKey, "GET", "/authorization/permissions")
  return data.data
}

async function createPermission(
  apiKey: string,
  perm: { slug: string; name: string; description: string }
): Promise<WorkOSPermission> {
  return workosRequest<WorkOSPermission>(apiKey, "POST", "/authorization/permissions", perm)
}

async function updatePermission(
  apiKey: string,
  slug: string,
  updates: { name: string; description: string }
): Promise<WorkOSPermission> {
  return workosRequest<WorkOSPermission>(apiKey, "PATCH", `/authorization/permissions/${slug}`, updates)
}

// --- Drift detection ---

interface DriftReport {
  missing: typeof API_KEY_PERMISSIONS
  stale: { slug: string; fields: string[] }[]
  orphans: WorkOSPermission[]
}

function detectDrift(remote: WorkOSPermission[]): DriftReport {
  const remoteBySlug = new Map(remote.filter((p) => !p.system).map((p) => [p.slug, p]))
  const localSlugs = new Set<string>(API_KEY_PERMISSIONS.map((p) => p.slug))

  const missing = API_KEY_PERMISSIONS.filter((p) => !remoteBySlug.has(p.slug))

  const stale: DriftReport["stale"] = []
  for (const local of API_KEY_PERMISSIONS) {
    const existing = remoteBySlug.get(local.slug)
    if (!existing) continue
    const fields: string[] = []
    if (existing.name !== local.name) fields.push("name")
    if (existing.description !== local.description) fields.push("description")
    if (fields.length > 0) stale.push({ slug: local.slug, fields })
  }

  const orphans = remote.filter((p) => !p.system && !localSlugs.has(p.slug))

  return { missing, stale, orphans }
}

function printDrift(drift: DriftReport): boolean {
  const hasDrift = drift.missing.length > 0 || drift.stale.length > 0 || drift.orphans.length > 0

  if (!hasDrift) {
    console.log("No drift detected. WorkOS permissions match code definitions.")
    return false
  }

  if (drift.missing.length > 0) {
    console.log(`Missing in WorkOS (${drift.missing.length}):`)
    for (const p of drift.missing) console.log(`  - ${p.slug} ("${p.name}")`)
    console.log()
  }

  if (drift.stale.length > 0) {
    console.log(`Out of date in WorkOS (${drift.stale.length}):`)
    for (const p of drift.stale) console.log(`  - ${p.slug} (${p.fields.join(", ")} differ)`)
    console.log()
  }

  if (drift.orphans.length > 0) {
    console.log(`Orphans in WorkOS not in code (${drift.orphans.length}):`)
    for (const p of drift.orphans) console.log(`  - ${p.slug} ("${p.name}") — delete via dashboard`)
    console.log()
  }

  return true
}

// --- Sync logic ---

async function check() {
  const apiKey = loadApiKey()
  const remote = await listPermissions(apiKey)
  const drift = detectDrift(remote)

  // Missing and stale are informational — the sync on merge to main handles those.
  // Only orphans are a hard failure: they indicate permissions in WorkOS that have
  // been removed from code and need manual dashboard cleanup.
  if (drift.missing.length > 0) {
    console.log(`Pending (${drift.missing.length} — will be created on merge):`)
    for (const p of drift.missing) console.log(`  - ${p.slug} ("${p.name}")`)
    console.log()
  }

  if (drift.stale.length > 0) {
    console.log(`Stale (${drift.stale.length} — will be updated on merge):`)
    for (const p of drift.stale) console.log(`  - ${p.slug} (${p.fields.join(", ")} differ)`)
    console.log()
  }

  if (drift.orphans.length > 0) {
    console.log(`Orphans in WorkOS not in code (${drift.orphans.length}):`)
    for (const p of drift.orphans) console.log(`  - ${p.slug} ("${p.name}") — delete via dashboard`)
    console.log()
    console.error("Check failed: orphaned permissions found. Remove them from the WorkOS dashboard.")
    process.exit(1)
  }

  if (drift.missing.length === 0 && drift.stale.length === 0) {
    console.log("No drift detected. WorkOS permissions match code definitions.")
  }
}

async function sync(dryRun: boolean) {
  const apiKey = loadApiKey()
  const remote = await listPermissions(apiKey)
  const drift = detectDrift(remote)

  console.log(`Found ${remote.length} permissions in WorkOS (${remote.filter((p) => !p.system).length} non-system)`)
  console.log(`Local definitions: ${API_KEY_PERMISSIONS.length}\n`)

  let created = 0
  let updated = 0
  let unchanged = 0

  for (const local of API_KEY_PERMISSIONS) {
    const isMissing = drift.missing.some((p) => p.slug === local.slug)
    const staleEntry = drift.stale.find((p) => p.slug === local.slug)

    if (isMissing) {
      if (dryRun) {
        console.log(`  [CREATE] ${local.slug} — "${local.name}"`)
      } else {
        await createPermission(apiKey, { slug: local.slug, name: local.name, description: local.description })
        console.log(`  [CREATED] ${local.slug} — "${local.name}"`)
      }
      created++
    } else if (staleEntry) {
      if (dryRun) {
        console.log(`  [UPDATE] ${local.slug} (${staleEntry.fields.join(", ")})`)
      } else {
        await updatePermission(apiKey, local.slug, { name: local.name, description: local.description })
        console.log(`  [UPDATED] ${local.slug}`)
      }
      updated++
    } else {
      console.log(`  [OK] ${local.slug}`)
      unchanged++
    }
  }

  for (const orphan of drift.orphans) {
    console.log(`  [ORPHAN] ${orphan.slug} — exists in WorkOS but not in code (delete via dashboard)`)
  }

  console.log(`\n${dryRun ? "Dry run" : "Done"}: ${created} created, ${updated} updated, ${unchanged} unchanged`)
  if (drift.orphans.length > 0) {
    console.log(`${drift.orphans.length} orphan(s) need manual deletion in WorkOS dashboard`)
  }
}

// --- Main ---

const mode = process.argv.includes("--check") ? "check" : process.argv.includes("--dry-run") ? "dry-run" : "sync"

const run = mode === "check" ? check() : sync(mode === "dry-run")

run.catch((err) => {
  console.error("Failed:", err.message)
  process.exit(1)
})
