/**
 * Clean up duplicate WorkOS organizations.
 *
 * Lists all orgs, groups by name, and deletes duplicates — keeping the one
 * with an externalId (if any), otherwise the most recently created.
 *
 * Usage: bun scripts/workos-cleanup-orgs.ts [--dry-run]
 */
import { WorkOS } from "@workos-inc/node"

const apiKey = process.env.WORKOS_API_KEY
const clientId = process.env.WORKOS_CLIENT_ID
if (!apiKey || !clientId) {
  console.error("WORKOS_API_KEY and WORKOS_CLIENT_ID must be set")
  process.exit(1)
}

const dryRun = process.argv.includes("--dry-run")
const workos = new WorkOS(apiKey, { clientId })

const allOrgs = await workos.organizations.listOrganizations({ limit: 100 }).then((r) => r.autoPagination())

console.log(`Found ${allOrgs.length} total organizations\n`)

// Group by name
const byName = new Map<string, typeof allOrgs>()
for (const org of allOrgs) {
  const group = byName.get(org.name) ?? []
  group.push(org)
  byName.set(org.name, group)
}

let deletedCount = 0

for (const [name, orgs] of byName) {
  if (orgs.length === 1) continue

  console.log(`"${name}" — ${orgs.length} organizations:`)

  // Prefer the one with an externalId, otherwise the newest
  const sorted = orgs.sort((a, b) => {
    if (a.externalId && !b.externalId) return -1
    if (!a.externalId && b.externalId) return 1
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  const keep = sorted[0]
  const toDelete = sorted.slice(1)

  console.log(`  KEEP: ${keep.id} (externalId: ${keep.externalId ?? "none"}, created: ${keep.createdAt})`)

  for (const org of toDelete) {
    console.log(`  DELETE: ${org.id} (externalId: ${org.externalId ?? "none"}, created: ${org.createdAt})`)
    if (!dryRun) {
      await workos.organizations.deleteOrganization(org.id)
    }
    deletedCount++
  }
  console.log()
}

if (deletedCount === 0) {
  console.log("No duplicates found.")
} else {
  console.log(`${dryRun ? "Would delete" : "Deleted"} ${deletedCount} duplicate organizations.`)
}
