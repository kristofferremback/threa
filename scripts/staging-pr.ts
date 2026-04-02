/**
 * Staging PR lifecycle management — deploys per-PR backend + database environments.
 *
 * Usage:
 *   bun scripts/staging-pr.ts --action=deploy  --pr=123 --branch=my-feature
 *   bun scripts/staging-pr.ts --action=teardown --pr=123
 *
 * Environment variables (set in GH Actions secrets):
 *   STAGING_DATABASE_URL    — postgres connection string to the shared staging PG
 *   RAILWAY_TOKEN           — Railway API token
 *   RAILWAY_PROJECT_ID      — Railway project ID for the staging project
 *   CLOUDFLARE_API_TOKEN    — CF API token with KV write access
 *   CLOUDFLARE_ACCOUNT_ID   — CF account ID
 *   STAGING_KV_NAMESPACE_ID — CF KV namespace ID for the staging workspace-router
 *   STAGING_INTERNAL_API_KEY — shared secret for inter-service auth
 *   STAGING_CONTROL_PLANE_URL — URL of the shared staging control plane
 *   STAGING_CORS_ORIGINS    — comma-separated CORS origins (CF Pages preview URLs)
 */

import { parseArgs } from "util"
import { $ } from "bun"
import path from "path"
import { readdir } from "fs/promises"

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    action: { type: "string" },
    pr: { type: "string" },
    branch: { type: "string" },
  },
})

const action = values.action
const prNumber = values.pr
const branch = values.branch

if (!action || !prNumber) {
  console.error("Usage: --action=deploy|teardown --pr=<number> [--branch=<name>]")
  process.exit(1)
}

if (action === "deploy" && !branch) {
  console.error("--branch is required for deploy action")
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const val = process.env[name]
  if (!val) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
  return val
}

const STAGING_DATABASE_URL = requireEnv("STAGING_DATABASE_URL")
const RAILWAY_TOKEN = requireEnv("RAILWAY_TOKEN")
const RAILWAY_PROJECT_ID = requireEnv("RAILWAY_PROJECT_ID")
const CLOUDFLARE_API_TOKEN = requireEnv("CLOUDFLARE_API_TOKEN")
const CLOUDFLARE_ACCOUNT_ID = requireEnv("CLOUDFLARE_ACCOUNT_ID")
const STAGING_KV_NAMESPACE_ID = requireEnv("STAGING_KV_NAMESPACE_ID")
const STAGING_INTERNAL_API_KEY = requireEnv("STAGING_INTERNAL_API_KEY")
const STAGING_CONTROL_PLANE_URL = requireEnv("STAGING_CONTROL_PLANE_URL")
const CLOUDFLARE_ZONE_ID = requireEnv("CLOUDFLARE_ZONE_ID")
const STAGING_WORKER_NAME = process.env.STAGING_WORKER_NAME ?? "workspace-router-staging"
const STAGING_CORS_ORIGINS = process.env.STAGING_CORS_ORIGINS ?? ""

const prDbName = `pr_${prNumber}`
const prCpDbName = `pr_${prNumber}_cp`
const regionName = `pr-${prNumber}`
const serviceName = `pr-${prNumber}-backend`
/** Flat subdomain: pr-228-staging.threa.io (covered by *.threa.io cert) */
const prHostname = `pr-${prNumber}-staging.threa.io`

// ---------------------------------------------------------------------------
// Database helpers (uses psql via STAGING_DATABASE_URL)
// ---------------------------------------------------------------------------

async function runPsql(db: string, sql: string): Promise<string> {
  // Replace the database name in the URL
  const url = STAGING_DATABASE_URL.replace(/\/([^/?]+)(\?.*)?$/, `/${db}$2`)
  const result = await $`psql ${url} -tAc ${sql}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString()
    throw new Error(`psql failed: ${stderr}`)
  }
  return result.stdout.toString().trim()
}

async function runPsqlOnDefault(sql: string): Promise<string> {
  const result = await $`psql ${STAGING_DATABASE_URL} -tAc ${sql}`.quiet().nothrow()
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString()
    throw new Error(`psql failed: ${stderr}`)
  }
  return result.stdout.toString().trim()
}

async function databaseExists(dbName: string): Promise<boolean> {
  const result = await runPsqlOnDefault(`SELECT 1 FROM pg_database WHERE datname='${dbName}'`)
  return result === "1"
}

async function createDatabase(dbName: string): Promise<void> {
  if (await databaseExists(dbName)) {
    console.log(`Database '${dbName}' already exists, dropping first...`)
    await runPsqlOnDefault(`DROP DATABASE "${dbName}" WITH (FORCE)`)
  }
  console.log(`Creating database '${dbName}'...`)
  await runPsqlOnDefault(`CREATE DATABASE "${dbName}"`)
}

/**
 * Ensure umzug_migrations exists and contains an entry for every migration file.
 *
 * When a PR database is cloned from staging_main, the clone includes all tables
 * (e.g. agent_sessions) but umzug_migrations may be incomplete — the source DB
 * may be missing entries for migrations that were applied before tracking started,
 * or pg_dump may have partially failed. If the backend then starts and sees a
 * "pending" migration whose table already exists, it crashes with
 * "relation already exists".
 *
 * This function unconditionally seeds ALL migration filenames into
 * umzug_migrations with ON CONFLICT DO NOTHING, ensuring completeness.
 */
async function verifyUmzugMigrations(dbName: string, migrationsRelPath: string): Promise<void> {
  // Ensure the table exists
  await runPsql(
    dbName,
    "CREATE TABLE IF NOT EXISTS umzug_migrations (name VARCHAR(255) PRIMARY KEY, executed_at TIMESTAMPTZ DEFAULT NOW())"
  )

  // Read migration filenames from disk
  const migrationsDir = path.join(import.meta.dirname, "..", migrationsRelPath)
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort()

  if (files.length === 0) {
    throw new Error("No migration files found — cannot seed umzug_migrations")
  }

  // Insert each migration individually to avoid large SQL statements and
  // ensure partial failures are visible (runPsql throws on non-zero exit)
  let seeded = 0
  for (const file of files) {
    const result = await runPsql(
      dbName,
      `INSERT INTO umzug_migrations (name) VALUES ('${file}') ON CONFLICT DO NOTHING RETURNING name`
    )
    if (result) seeded++
  }

  // Verify the final count matches
  const count = await runPsql(dbName, "SELECT count(*) FROM umzug_migrations")
  const countNum = parseInt(count, 10)

  if (countNum < files.length) {
    throw new Error(
      `umzug_migrations has ${countNum} rows but ${files.length} migration files exist — ` +
        `${files.length - countNum} entries are missing after seeding`
    )
  }

  if (seeded > 0) {
    console.log(`Seeded ${seeded} missing entries into umzug_migrations (${countNum} total, ${files.length} files)`)
  } else {
    console.log(`umzug_migrations OK (${countNum} rows, all ${files.length} files present)`)
  }
}

async function cloneDatabase(sourceDb: string, targetDb: string): Promise<void> {
  console.log(`Cloning '${sourceDb}' → '${targetDb}'...`)
  const sourceUrl = STAGING_DATABASE_URL.replace(/\/([^/?]+)(\?.*)?$/, `/${sourceDb}$2`)
  const targetUrl = STAGING_DATABASE_URL.replace(/\/([^/?]+)(\?.*)?$/, `/${targetDb}$2`)

  // Use versioned pg_dump path if available (GH Actions installs PG 18 client alongside default PG 16)
  const pgDump =
    (await $`which /usr/lib/postgresql/18/bin/pg_dump`.quiet().nothrow()).exitCode === 0
      ? "/usr/lib/postgresql/18/bin/pg_dump"
      : "pg_dump"
  // Pipe pg_dump output into psql. Bun shell handles the pipe operator natively
  // and escapes interpolated values, avoiding bash -c string interpolation issues
  // with passwords containing shell-special characters ($, !, quotes, etc.)
  const result = await $`${pgDump} --clean --if-exists ${sourceUrl} | psql ${targetUrl}`.quiet().nothrow()

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString()
    throw new Error(`Database clone failed: ${stderr}`)
  }

  // Sync sequences (same pattern as setup-worktree.ts)
  console.log("Syncing sequences...")
  await runPsql(targetDb, "SELECT setval('outbox_id_seq', COALESCE((SELECT MAX(id) FROM outbox), 0) + 1, false)")

  // Reset outbox listener cursors
  console.log("Resetting outbox listener cursors...")
  await runPsql(targetDb, "UPDATE outbox_listeners SET last_processed_id = COALESCE((SELECT MAX(id) FROM outbox), 0)")

  console.log(`Cloned '${sourceDb}' → '${targetDb}'`)
}

async function dropDatabase(dbName: string): Promise<void> {
  if (!(await databaseExists(dbName))) {
    console.log(`Database '${dbName}' does not exist, skipping drop`)
    return
  }
  console.log(`Dropping database '${dbName}'...`)
  await runPsqlOnDefault(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dbName}' AND pid <> pg_backend_pid()`
  )
  await runPsqlOnDefault(`DROP DATABASE "${dbName}"`)
  console.log(`Dropped '${dbName}'`)
}

async function updateWorkspaceSlug(dbName: string, branchName: string): Promise<void> {
  const slug = branchName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)

  const name = `PR #${prNumber}`

  console.log(`Updating workspace slug to '${slug}' and name to '${name}'...`)
  await runPsql(
    dbName,
    `UPDATE workspaces SET slug = '${slug}', name = '${name}' WHERE id = (SELECT id FROM workspaces LIMIT 1)`
  )
}

// ---------------------------------------------------------------------------
// Railway helpers (uses Railway CLI via RAILWAY_TOKEN)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Railway GraphQL API helpers (replaces CLI calls for CI reliability)
// ---------------------------------------------------------------------------

const RAILWAY_API = "https://backboard.railway.com/graphql/v2"

async function railwayGql(query: string, variables?: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RAILWAY_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = (await res.json()) as { data?: unknown; errors?: { message: string }[] }
  if (json.errors?.length) {
    throw new Error(`Railway API error: ${json.errors[0].message}`)
  }
  return json.data
}

async function getEnvironmentId(): Promise<string> {
  const data = (await railwayGql(`{
    project(id: "${RAILWAY_PROJECT_ID}") {
      environments { edges { node { id name } } }
    }
  }`)) as { project: { environments: { edges: { node: { id: string; name: string } }[] } } }
  const prod = data.project.environments.edges.find((e) => e.node.name === "production")
  if (!prod) throw new Error("No production environment found")
  return prod.node.id
}

async function listServices(): Promise<{ id: string; name: string }[]> {
  const data = (await railwayGql(`{
    project(id: "${RAILWAY_PROJECT_ID}") {
      services { edges { node { id name } } }
    }
  }`)) as { project: { services: { edges: { node: { id: string; name: string } }[] } } }
  return data.project.services.edges.map((e) => e.node)
}

async function railwayServiceExists(): Promise<boolean> {
  const services = await listServices()
  return services.some((s) => s.name === serviceName)
}

async function createRailwayService(): Promise<string> {
  console.log(`Creating Railway service '${serviceName}'...`)

  let serviceId: string
  const services = await listServices()
  const existing = services.find((s) => s.name === serviceName)

  if (existing) {
    console.log(`Railway service '${serviceName}' already exists, reusing...`)
    serviceId = existing.id
  } else {
    const data = (await railwayGql(`mutation {
      serviceCreate(input: { name: "${serviceName}", projectId: "${RAILWAY_PROJECT_ID}" }) { id }
    }`)) as { serviceCreate: { id: string } }
    serviceId = data.serviceCreate.id
  }

  // Configure service instance to use Dockerfile (same as main backend)
  const environmentId = await getEnvironmentId()
  await railwayGql(`mutation {
    serviceInstanceUpdate(
      serviceId: "${serviceId}",
      environmentId: "${environmentId}",
      input: {
        dockerfilePath: "Dockerfile.backend",
        healthcheckPath: "/health",
        restartPolicyType: ON_FAILURE,
        restartPolicyMaxRetries: 5,
        watchPatterns: ["apps/backend/**", "packages/**", "Dockerfile.backend", "bun.lock"]
      }
    )
  }`)

  // Copy env vars from the main staging backend, then override PR-specific ones.
  // This ensures new vars (API keys, feature flags) propagate automatically.
  const mainBackend = (await listServices()).find((s) => s.name === "backend")
  let baseEnvVars: Record<string, string> = {}
  if (mainBackend) {
    baseEnvVars = (await railwayGql(`{
      variables(projectId: "${RAILWAY_PROJECT_ID}", environmentId: "${environmentId}", serviceId: "${mainBackend.id}")
    }`)) as Record<string, string>
    // The query returns { variables: { ... } }, extract it
    baseEnvVars = (baseEnvVars as unknown as { variables: Record<string, string> }).variables ?? {}
  }

  const prDbUrl = STAGING_DATABASE_URL.replace(/\/([^/?]+)(\?.*)?$/, `/${prDbName}$2`)
  const envVars: Record<string, string> = {
    ...baseEnvVars,
    // PR-specific overrides
    DATABASE_URL: prDbUrl,
    REGION: regionName,
    CORS_ALLOWED_ORIGINS: STAGING_CORS_ORIGINS,
    FAST_SHUTDOWN: "true",
  }

  await railwayGql(
    `mutation($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }`,
    {
      input: {
        projectId: RAILWAY_PROJECT_ID,
        environmentId,
        serviceId,
        variables: envVars,
      },
    }
  )

  console.log(`Railway service '${serviceName}' ready (ID: ${serviceId})`)
  return serviceId
}

async function deployRailwayService(): Promise<string> {
  console.log(`Deploying to Railway service '${serviceName}'...`)

  const services = await listServices()
  const service = services.find((s) => s.name === serviceName)
  if (!service) throw new Error("Service not found")

  const environmentId = await getEnvironmentId()

  // Connect service to the repo + branch (idempotent — updates if already connected)
  await railwayGql(
    `mutation($id: String!, $input: ServiceConnectInput!) {
      serviceConnect(id: $id, input: $input) { id }
    }`,
    { id: service.id, input: { repo: "kristofferremback/threa", branch } }
  )

  // Trigger deploy from latest commit on the branch
  await railwayGql(`mutation {
    serviceInstanceDeploy(serviceId: "${service.id}", environmentId: "${environmentId}")
  }`)

  console.log("Deploy triggered — Railway will build from the branch")

  // Get or create service domain
  const domainData = (await railwayGql(`{
    serviceInstance(serviceId: "${service.id}", environmentId: "${environmentId}") {
      domains { serviceDomains { domain } }
    }
  }`)) as { serviceInstance: { domains: { serviceDomains: { domain: string }[] } } }

  const existingDomain = domainData.serviceInstance.domains.serviceDomains[0]?.domain
  if (existingDomain) return `https://${existingDomain}`

  // Create a service domain if none exists
  const newDomain = (await railwayGql(`mutation {
    serviceDomainCreate(input: { serviceId: "${service.id}", environmentId: "${environmentId}" }) { domain }
  }`)) as { serviceDomainCreate: { domain: string } }
  return `https://${newDomain.serviceDomainCreate.domain}`
}

async function deleteRailwayService(): Promise<void> {
  const services = await listServices()
  const service = services.find((s) => s.name === serviceName)
  if (!service) {
    console.log(`Railway service '${serviceName}' does not exist, skipping`)
    return
  }
  console.log(`Deleting Railway service '${serviceName}'...`)
  await railwayGql(`mutation { serviceDelete(id: "${service.id}") }`)
  console.log(`Deleted Railway service '${serviceName}'`)
}

// ---------------------------------------------------------------------------
// Cloudflare KV helpers
// ---------------------------------------------------------------------------

const CF_KV_BASE = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${STAGING_KV_NAMESPACE_ID}`

async function kvGet(key: string): Promise<string | null> {
  const res = await fetch(`${CF_KV_BASE}/values/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
  })
  if (!res.ok) return null
  return res.text()
}

async function kvPut(key: string, value: string): Promise<void> {
  const res = await fetch(`${CF_KV_BASE}/values/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
    body: value,
  })
  if (!res.ok) {
    throw new Error(`KV put failed for key '${key}': ${await res.text()}`)
  }
}

async function kvDelete(key: string): Promise<void> {
  const res = await fetch(`${CF_KV_BASE}/values/${encodeURIComponent(key)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
  })
  if (!res.ok) {
    throw new Error(`KV delete failed for key '${key}': ${await res.text()}`)
  }
}

/**
 * Register this PR's region in the shared KV regions config.
 *
 * WARNING: read-modify-write race condition. If two PR deploys run concurrently,
 * one write can clobber the other's region entry. This is acceptable for now
 * because staging PR deploys are infrequent and the lost region is re-registered
 * on the next push. A proper fix would use KV metadata + compare-and-swap or a
 * mutex (e.g. Cloudflare Durable Object lock).
 */
async function registerRegion(backendUrl: string): Promise<void> {
  // Read current regions config from KV
  const existing = await kvGet("__regions_config__")
  const regions: Record<string, { apiUrl: string; wsUrl: string }> = existing ? JSON.parse(existing) : {}

  // Add this PR's region
  regions[regionName] = { apiUrl: backendUrl, wsUrl: backendUrl }
  await kvPut("__regions_config__", JSON.stringify(regions))
  console.log(`Registered region '${regionName}' → ${backendUrl}`)
}

async function registerWorkspaceRegion(dbName: string): Promise<void> {
  // Get workspace ID from the cloned database
  const workspaceId = await runPsql(dbName, "SELECT id FROM workspaces LIMIT 1")
  if (!workspaceId) {
    console.warn("No workspace found in cloned database — skipping KV workspace mapping")
    return
  }

  await kvPut(workspaceId, regionName)
  console.log(`Mapped workspace '${workspaceId}' → region '${regionName}'`)
}

async function unregisterRegion(): Promise<void> {
  const existing = await kvGet("__regions_config__")
  if (!existing) return

  const regions: Record<string, unknown> = JSON.parse(existing)
  delete regions[regionName]
  await kvPut("__regions_config__", JSON.stringify(regions))
  console.log(`Unregistered region '${regionName}'`)
}

async function unregisterWorkspaceRegion(): Promise<void> {
  // We need to find the workspace ID — check if PR DB still exists
  try {
    const workspaceId = await runPsql(prDbName, "SELECT id FROM workspaces LIMIT 1")
    if (workspaceId) {
      await kvDelete(workspaceId)
      console.log(`Removed workspace mapping for '${workspaceId}'`)
    }
  } catch {
    console.warn("Could not look up workspace ID for KV cleanup — DB may already be dropped")
  }
}

// ---------------------------------------------------------------------------
// Cloudflare DNS + Worker Route helpers (per-PR subdomain)
// ---------------------------------------------------------------------------

const CF_ZONE_BASE = `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}`

async function cfApi(
  path: string,
  method: string,
  body?: unknown
): Promise<{ success: boolean; result?: Record<string, unknown>; errors?: { message: string }[] }> {
  const res = await fetch(`${CF_ZONE_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return res.json() as Promise<{ success: boolean; result?: Record<string, unknown>; errors?: { message: string }[] }>
}

async function findDnsRecord(name: string): Promise<string | null> {
  const res = await fetch(`${CF_ZONE_BASE}/dns_records?name=${name}`, {
    headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
  })
  const data = (await res.json()) as { result: { id: string }[] }
  return data.result?.[0]?.id ?? null
}

async function findWorkerRoute(pattern: string): Promise<string | null> {
  const res = await fetch(`${CF_ZONE_BASE}/workers/routes`, {
    headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
  })
  const data = (await res.json()) as { result: { id: string; pattern: string }[] }
  return data.result?.find((r) => r.pattern === pattern)?.id ?? null
}

async function createPrDnsAndRoute(): Promise<void> {
  // Create proxied AAAA record for pr-N-staging.threa.io
  const existingDns = await findDnsRecord(prHostname)
  if (!existingDns) {
    const dns = await cfApi("/dns_records", "POST", {
      type: "AAAA",
      name: `pr-${prNumber}-staging`,
      content: "100::",
      proxied: true,
      comment: `Staging PR #${prNumber}`,
    })
    if (!dns.success) {
      throw new Error(`Failed to create DNS record: ${dns.errors?.[0]?.message}`)
    }
    console.log(`Created DNS record for ${prHostname}`)
  } else {
    console.log(`DNS record for ${prHostname} already exists`)
  }

  // Create worker route
  const routePattern = `${prHostname}/*`
  const existingRoute = await findWorkerRoute(routePattern)
  if (!existingRoute) {
    const route = await cfApi("/workers/routes", "POST", {
      pattern: routePattern,
      script: STAGING_WORKER_NAME,
    })
    if (!route.success) {
      throw new Error(`Failed to create worker route: ${route.errors?.[0]?.message}`)
    }
    console.log(`Created worker route ${routePattern} → ${STAGING_WORKER_NAME}`)
  } else {
    console.log(`Worker route for ${prHostname} already exists`)
  }
}

async function deletePrDnsAndRoute(): Promise<void> {
  // Delete worker route
  const routePattern = `${prHostname}/*`
  const routeId = await findWorkerRoute(routePattern)
  if (routeId) {
    await cfApi(`/workers/routes/${routeId}`, "DELETE")
    console.log(`Deleted worker route for ${prHostname}`)
  }

  // Delete DNS record
  const dnsId = await findDnsRecord(prHostname)
  if (dnsId) {
    await cfApi(`/dns_records/${dnsId}`, "DELETE")
    console.log(`Deleted DNS record for ${prHostname}`)
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function deploy(): Promise<void> {
  console.log(`\n=== Deploying staging environment for PR #${prNumber} (branch: ${branch}) ===\n`)

  // 1. Create and clone databases (only on first deploy — skip if DBs already exist
  //    AND have valid data. If a previous deploy failed mid-clone, the DB exists
  //    but is empty/broken — detect this and re-clone.)
  const dbExists = await databaseExists(prDbName)
  let isFirstDeploy = !dbExists
  if (dbExists) {
    try {
      const workspaceCount = await runPsql(prDbName, "SELECT count(*) FROM workspaces")
      if (workspaceCount === "0") {
        console.log(`Database '${prDbName}' exists but has no workspaces — re-cloning`)
        isFirstDeploy = true
      }
    } catch {
      console.log(`Database '${prDbName}' exists but is not queryable — re-cloning`)
      isFirstDeploy = true
    }
  }
  // Also check the control-plane DB — a deploy can fail between the two clone calls
  if (!isFirstDeploy) {
    const cpDbExists = await databaseExists(prCpDbName)
    if (!cpDbExists) {
      console.log(`Control-plane database '${prCpDbName}' missing — re-cloning both`)
      isFirstDeploy = true
    } else {
      try {
        await runPsql(prCpDbName, "SELECT 1 FROM workos_users LIMIT 1")
      } catch {
        console.log(`Control-plane database '${prCpDbName}' is not queryable — re-cloning both`)
        isFirstDeploy = true
      }
    }
  }

  if (isFirstDeploy) {
    await createDatabase(prDbName)
    await cloneDatabase("staging_main", prDbName)
    await updateWorkspaceSlug(prDbName, branch!)

    await createDatabase(prCpDbName)
    await cloneDatabase("staging_main_cp", prCpDbName)
  } else {
    console.log(`Databases already exist — skipping clone`)
  }

  // Always ensure umzug_migrations is complete — even on re-deploys the table
  // may be incomplete from a previous failed clone. This is idempotent
  // (ON CONFLICT DO NOTHING) so safe to run every time.
  await verifyUmzugMigrations(prDbName, "apps/backend/src/db/migrations")
  await verifyUmzugMigrations(prCpDbName, "apps/control-plane/src/db/migrations")

  // 2. Create and deploy Railway service
  await createRailwayService()
  const backendUrl = await deployRailwayService()

  // 3. Register in Cloudflare KV
  await registerRegion(backendUrl)
  if (isFirstDeploy) {
    await registerWorkspaceRegion(prDbName)
  }

  // 4. Create DNS record + worker route for pr-N-staging.threa.io
  await createPrDnsAndRoute()

  console.log(`\n=== Staging environment deployed ===`)
  console.log(`Frontend: https://${prHostname}`)
  console.log(`Backend: ${backendUrl}`)
  console.log(`Region: ${regionName}`)
  console.log(`Database: ${prDbName}`)
}

async function teardown(): Promise<void> {
  console.log(`\n=== Tearing down staging environment for PR #${prNumber} ===\n`)

  // 1. Unregister from KV (before dropping DB, since we need workspace ID)
  await unregisterWorkspaceRegion()
  await unregisterRegion()

  // 2. Delete DNS record + worker route
  await deletePrDnsAndRoute()

  // 3. Delete Railway service
  await deleteRailwayService()

  // 4. Drop databases
  await dropDatabase(prDbName)
  await dropDatabase(prCpDbName)

  console.log(`\n=== Staging environment torn down ===`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  switch (action) {
    case "deploy":
      await deploy()
      break
    case "teardown":
      await teardown()
      break
    default:
      console.error(`Unknown action: ${action}`)
      process.exit(1)
  }
}

main().catch((err) => {
  console.error("Staging PR script failed:", err)
  process.exit(1)
})
