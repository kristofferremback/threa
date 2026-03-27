/**
 * Staging PR lifecycle management.
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
const STAGING_CORS_ORIGINS = process.env.STAGING_CORS_ORIGINS ?? ""

const prDbName = `pr_${prNumber}`
const prCpDbName = `pr_${prNumber}_cp`
const regionName = `pr-${prNumber}`
const serviceName = `pr-${prNumber}-backend`

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
    // Terminate connections before dropping
    await runPsqlOnDefault(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${dbName}' AND pid <> pg_backend_pid()`
    )
    await runPsqlOnDefault(`DROP DATABASE "${dbName}"`)
  }
  console.log(`Creating database '${dbName}'...`)
  await runPsqlOnDefault(`CREATE DATABASE "${dbName}"`)
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
  const result = await $`bash -o pipefail -c "${pgDump} --clean --if-exists ${sourceUrl} | psql ${targetUrl}"`
    .quiet()
    .nothrow()

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

  // Set environment variables
  const environmentId = await getEnvironmentId()
  const prDbUrl = STAGING_DATABASE_URL.replace(/\/([^/?]+)(\?.*)?$/, `/${prDbName}$2`)
  const envVars: Record<string, string> = {
    DATABASE_URL: prDbUrl,
    PORT: "8080",
    NODE_ENV: "production",
    CONTROL_PLANE_URL: STAGING_CONTROL_PLANE_URL,
    INTERNAL_API_KEY: STAGING_INTERNAL_API_KEY,
    REGION: regionName,
    CORS_ALLOWED_ORIGINS: STAGING_CORS_ORIGINS,
    FAST_SHUTDOWN: "true",
    LOG_LEVEL: "info",
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
  await railwayGql(`mutation {
    serviceConnect(id: "${service.id}", input: { repo: "kristofferremback/threa", branch: "${branch}" }) { id }
  }`)

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
  await fetch(`${CF_KV_BASE}/values/${encodeURIComponent(key)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
  })
}

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
// Actions
// ---------------------------------------------------------------------------

async function deploy(): Promise<void> {
  console.log(`\n=== Deploying staging environment for PR #${prNumber} (branch: ${branch}) ===\n`)

  // 1. Create and clone databases (only on first deploy — skip if DBs already exist)
  const isFirstDeploy = !(await databaseExists(prDbName))

  if (isFirstDeploy) {
    await createDatabase(prDbName)
    await cloneDatabase("staging_main", prDbName)
    await updateWorkspaceSlug(prDbName, branch!)

    await createDatabase(prCpDbName)
    await cloneDatabase("staging_main_cp", prCpDbName)
  } else {
    console.log(`Databases already exist — skipping clone (migrations run on backend startup)`)
  }

  // 2. Create and deploy Railway service
  await createRailwayService()
  const backendUrl = await deployRailwayService()

  // 3. Register in Cloudflare KV
  await registerRegion(backendUrl)
  if (isFirstDeploy) {
    await registerWorkspaceRegion(prDbName)
  }

  console.log(`\n=== Staging environment deployed ===`)
  console.log(`Backend: ${backendUrl}`)
  console.log(`Region: ${regionName}`)
  console.log(`Database: ${prDbName}`)
}

async function teardown(): Promise<void> {
  console.log(`\n=== Tearing down staging environment for PR #${prNumber} ===\n`)

  // 1. Unregister from KV (before dropping DB, since we need workspace ID)
  await unregisterWorkspaceRegion()
  await unregisterRegion()

  // 2. Delete Railway service
  await deleteRailwayService()

  // 3. Drop databases
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
