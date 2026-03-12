/**
 * Sync WorkOS authorization config from code definitions.
 *
 * Reads API_KEY_PERMISSIONS from @threa/types and ensures they exist in WorkOS.
 * Creates missing permissions, updates name/description on existing ones.
 *
 * Usage:
 *   bun scripts/sync-workos-permissions.ts              # uses apps/backend/.env
 *   WORKOS_API_KEY=sk_... bun scripts/sync-workos-permissions.ts
 *   bun scripts/sync-workos-permissions.ts --dry-run    # preview without changes
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

// --- Sync logic ---

async function sync(dryRun: boolean) {
  const apiKey = loadApiKey()
  const remote = await listPermissions(apiKey)
  const remoteBySlug = new Map(remote.filter((p) => !p.system).map((p) => [p.slug, p]))

  console.log(`Found ${remote.length} permissions in WorkOS (${remoteBySlug.size} non-system)`)
  console.log(`Local definitions: ${API_KEY_PERMISSIONS.length}\n`)

  let created = 0
  let updated = 0
  let unchanged = 0

  for (const local of API_KEY_PERMISSIONS) {
    const existing = remoteBySlug.get(local.slug)

    if (!existing) {
      if (dryRun) {
        console.log(`  [CREATE] ${local.slug} — "${local.name}"`)
      } else {
        await createPermission(apiKey, { slug: local.slug, name: local.name, description: local.description })
        console.log(`  [CREATED] ${local.slug} — "${local.name}"`)
      }
      created++
      continue
    }

    const needsUpdate = existing.name !== local.name || existing.description !== local.description

    if (needsUpdate) {
      if (dryRun) {
        console.log(`  [UPDATE] ${local.slug}`)
        if (existing.name !== local.name) console.log(`    name: "${existing.name}" → "${local.name}"`)
        if (existing.description !== local.description) console.log(`    description: changed`)
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

  // Warn about remote permissions not in code (but don't delete — API doesn't support it)
  for (const [slug] of remoteBySlug) {
    if (!API_KEY_PERMISSIONS.some((p) => p.slug === slug)) {
      console.log(`  [ORPHAN] ${slug} — exists in WorkOS but not in code (delete via dashboard)`)
    }
  }

  console.log(`\n${dryRun ? "Dry run" : "Done"}: ${created} created, ${updated} updated, ${unchanged} unchanged`)
}

// --- Main ---

const dryRun = process.argv.includes("--dry-run")
if (dryRun) console.log("DRY RUN — no changes will be made\n")

sync(dryRun).catch((err) => {
  console.error("Sync failed:", err.message)
  process.exit(1)
})
