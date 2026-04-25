/**
 * Sync WorkOS authorization config from code definitions.
 *
 * Reads WORKSPACE_PERMISSIONS from @threa/types and ensures they exist in WorkOS.
 * Creates missing permissions, updates name/description on existing ones.
 * Also ensures required roles exist with the correct permissions.
 *
 * Usage:
 *   bun scripts/sync-workos-permissions.ts              # sync (create/update)
 *   bun scripts/sync-workos-permissions.ts --dry-run    # preview without changes
 *   bun scripts/sync-workos-permissions.ts --check      # check for drift, exit 1 if found
 *   WORKOS_API_KEY=sk_... bun scripts/sync-workos-permissions.ts
 */

import * as fs from "fs"
import * as path from "path"
import { WORKSPACE_PERMISSIONS } from "../packages/types/src"

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

// --- Role definitions ---
// Roles required for Threa's default workspace authorization model.

interface RoleDefinition {
  slug: string
  name: string
  description: string
  permissions: string[]
}

const REQUIRED_ROLES: RoleDefinition[] = [
  {
    slug: "admin",
    name: "Admin",
    description: "Full workspace administration including integrations, bots, and member management",
    permissions: [
      "widgets:api-keys:manage",
      "messages:search",
      "streams:read",
      "messages:read",
      "messages:write",
      "users:read",
      "memos:read",
      "attachments:read",
      "members:write",
      "workspace:admin",
    ],
  },
  {
    slug: "member",
    name: "Member",
    description: "Default workspace member",
    permissions: [
      "messages:search",
      "streams:read",
      "messages:read",
      "messages:write",
      "users:read",
      "memos:read",
      "attachments:read",
    ],
  },
]

// --- Role API client ---

interface WorkOSRole {
  id: string
  slug: string
  name: string
  description: string | null
  permissions: string[]
  type: string
}

async function listRoles(apiKey: string): Promise<WorkOSRole[]> {
  const data = await workosRequest<{ data: WorkOSRole[] }>(apiKey, "GET", "/authorization/roles")
  return data.data
}

async function createRole(
  apiKey: string,
  role: { slug: string; name: string; description: string }
): Promise<WorkOSRole> {
  return workosRequest<WorkOSRole>(apiKey, "POST", "/authorization/roles", role)
}

async function updateRole(
  apiKey: string,
  slug: string,
  updates: { name?: string; description?: string }
): Promise<WorkOSRole> {
  return workosRequest<WorkOSRole>(apiKey, "PATCH", `/authorization/roles/${slug}`, updates)
}

async function setRolePermissions(apiKey: string, roleSlug: string, permissions: string[]): Promise<void> {
  await workosRequest<unknown>(apiKey, "PUT", `/authorization/roles/${roleSlug}/permissions`, { permissions })
}

interface RoleDriftEntry {
  slug: string
  fields: string[]
  missingPermissions: string[]
  extraPermissions: string[]
}

function detectRoleDrift(remoteRoles: WorkOSRole[]): RoleDriftEntry[] {
  const remoteRolesBySlug = new Map(remoteRoles.map((role) => [role.slug, role]))

  return REQUIRED_ROLES.flatMap((role) => {
    const existing = remoteRolesBySlug.get(role.slug)
    if (!existing) {
      return [
        {
          slug: role.slug,
          fields: ["missing"],
          missingPermissions: [...role.permissions],
          extraPermissions: [],
        },
      ]
    }

    const fields: string[] = []
    if (existing.name !== role.name) fields.push("name")
    if ((existing.description ?? "") !== role.description) fields.push("description")

    const existingPerms = new Set(existing.permissions)
    const requiredPerms = new Set(role.permissions)
    const missingPermissions = role.permissions.filter((permission) => !existingPerms.has(permission))
    const extraPermissions = existing.permissions.filter((permission) => !requiredPerms.has(permission))

    if (fields.length === 0 && missingPermissions.length === 0 && extraPermissions.length === 0) {
      return []
    }

    return [{ slug: role.slug, fields, missingPermissions, extraPermissions }]
  })
}

// --- Drift detection ---

interface DriftReport {
  missing: typeof WORKSPACE_PERMISSIONS
  stale: { slug: string; fields: string[] }[]
  orphans: WorkOSPermission[]
}

function detectDrift(remote: WorkOSPermission[]): DriftReport {
  const remoteBySlug = new Map(remote.filter((p) => !p.system).map((p) => [p.slug, p]))
  const localSlugs = new Set<string>(WORKSPACE_PERMISSIONS.map((p) => p.slug))

  const missing = WORKSPACE_PERMISSIONS.filter((p) => !remoteBySlug.has(p.slug))

  const stale: DriftReport["stale"] = []
  for (const local of WORKSPACE_PERMISSIONS) {
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

  // --- Role check ---
  console.log("\n--- Roles ---\n")
  const remoteRoles = await listRoles(apiKey)
  const roleDriftEntries = detectRoleDrift(remoteRoles)
  const roleDriftBySlug = new Map(roleDriftEntries.map((entry) => [entry.slug, entry]))

  for (const role of REQUIRED_ROLES) {
    const driftEntry = roleDriftBySlug.get(role.slug)
    if (!driftEntry) {
      console.log(`  [OK] role "${role.slug}"`)
      continue
    }

    if (driftEntry.fields.includes("missing")) {
      console.log(`  [MISSING] role "${role.slug}" — will be created on merge`)
      continue
    }

    const issues: string[] = []
    if (driftEntry.fields.length > 0) {
      issues.push(`fields differ: [${driftEntry.fields.join(", ")}]`)
    }
    if (driftEntry.missingPermissions.length > 0) {
      issues.push(`missing permissions: [${driftEntry.missingPermissions.join(", ")}]`)
    }
    if (driftEntry.extraPermissions.length > 0) {
      issues.push(`extra permissions: [${driftEntry.extraPermissions.join(", ")}]`)
    }
    console.log(`  [STALE] role "${role.slug}" — ${issues.join("; ")}`)
  }

  if (roleDriftEntries.length === 0) {
    console.log("No role drift detected.")
  }
}

async function sync(dryRun: boolean) {
  const apiKey = loadApiKey()
  const remote = await listPermissions(apiKey)
  const drift = detectDrift(remote)

  console.log(`Found ${remote.length} permissions in WorkOS (${remote.filter((p) => !p.system).length} non-system)`)
  console.log(`Local definitions: ${WORKSPACE_PERMISSIONS.length}\n`)

  let created = 0
  let updated = 0
  let unchanged = 0

  for (const local of WORKSPACE_PERMISSIONS) {
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

  // --- Role sync ---
  console.log("\n--- Roles ---\n")
  const remoteRoles = await listRoles(apiKey)
  const remoteRolesBySlug = new Map(remoteRoles.map((r) => [r.slug, r]))
  const roleDriftBySlug = new Map(detectRoleDrift(remoteRoles).map((entry) => [entry.slug, entry]))

  for (const role of REQUIRED_ROLES) {
    const existing = remoteRolesBySlug.get(role.slug)
    const driftEntry = roleDriftBySlug.get(role.slug)

    if (!existing) {
      if (dryRun) {
        console.log(`  [CREATE] role "${role.slug}" — "${role.name}"`)
      } else {
        await createRole(apiKey, { slug: role.slug, name: role.name, description: role.description })
        if (role.permissions.length > 0) {
          await setRolePermissions(apiKey, role.slug, role.permissions)
        }
        console.log(`  [CREATED] role "${role.slug}" with permissions: [${role.permissions.join(", ")}]`)
      }
    } else {
      if (driftEntry?.fields.length) {
        const fieldSummary = driftEntry.fields.join(", ")
        if (dryRun) {
          console.log(`  [UPDATE] role "${role.slug}" — syncing fields: [${fieldSummary}]`)
        } else {
          await updateRole(apiKey, role.slug, { name: role.name, description: role.description })
          console.log(`  [UPDATED] role "${role.slug}" — synced fields: [${fieldSummary}]`)
        }
      }

      if (driftEntry && (driftEntry.missingPermissions.length > 0 || driftEntry.extraPermissions.length > 0)) {
        const changes: string[] = []
        if (driftEntry.missingPermissions.length > 0) {
          changes.push(`adding [${driftEntry.missingPermissions.join(", ")}]`)
        }
        if (driftEntry.extraPermissions.length > 0) {
          changes.push(`removing [${driftEntry.extraPermissions.join(", ")}]`)
        }
        if (dryRun) {
          console.log(`  [UPDATE] role "${role.slug}" — ${changes.join("; ")}`)
        } else {
          await setRolePermissions(apiKey, role.slug, role.permissions)
          console.log(`  [UPDATED] role "${role.slug}" — ${changes.join("; ")}`)
        }
      } else {
        console.log(`  [OK] role "${role.slug}"`)
      }
    }
  }
}

// --- Main ---

const mode = process.argv.includes("--check") ? "check" : process.argv.includes("--dry-run") ? "dry-run" : "sync"

const run = mode === "check" ? check() : sync(mode === "dry-run")

run.catch((err) => {
  console.error("Failed:", err.message)
  process.exit(1)
})
