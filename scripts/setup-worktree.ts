import { $ } from "bun"
import * as path from "path"
import * as fs from "fs"
import * as os from "os"

interface ClaudeProjectConfig {
  mcpServers?: Record<string, unknown>
  enabledMcpjsonServers?: string[]
  disabledMcpjsonServers?: string[]
  hasTrustDialogAccepted?: boolean
  [key: string]: unknown
}

interface ClaudeConfig {
  projects?: Record<string, ClaudeProjectConfig>
  [key: string]: unknown
}

interface WorktreeInfo {
  path: string
  branch: string
  isMain: boolean
}

async function getWorktrees(): Promise<WorktreeInfo[]> {
  const result = await $`git worktree list --porcelain`.text()
  const worktrees: WorktreeInfo[] = []
  let current: Partial<WorktreeInfo> = {}

  for (const line of result.split("\n")) {
    if (line.startsWith("worktree ")) {
      current.path = line.slice(9)
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice(7)
    } else if (line === "bare") {
      current.isMain = true
    } else if (line === "") {
      if (current.path) {
        worktrees.push({
          path: current.path,
          branch: current.branch || "unknown",
          isMain: current.isMain || false,
        })
      }
      current = {}
    }
  }

  return worktrees
}

function getMainWorktree(worktrees: WorktreeInfo[]): WorktreeInfo | undefined {
  // First try to find the bare repo (true main)
  const bare = worktrees.find((w) => w.isMain)
  if (bare) return bare

  // Try to find one on main/master branch
  const mainBranch = worktrees.find((w) => w.branch.endsWith("/main") || w.branch.endsWith("/master"))
  if (mainBranch) return mainBranch

  // Heuristic: worktrees are typically named <project>.<branch> while the main is just <project>
  // So the main worktree path doesn't contain a dot in the directory name
  const mainByNaming = worktrees.find((w) => {
    const dirName = path.basename(w.path)
    return !dirName.includes(".")
  })
  if (mainByNaming) return mainByNaming

  // Fallback: first worktree listed is usually the original
  return worktrees[0]
}

function deriveDatabaseName(dirPath: string): string {
  const dirName = path.basename(dirPath)
  // Convert to valid postgres identifier: lowercase, underscores for special chars
  const sanitized = dirName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")

  return sanitized || "threa"
}

function updateDatabaseUrl(envContent: string, newDbName: string): string {
  // Replace database name in DATABASE_URL
  // Format: postgresql://user:pass@host:port/dbname
  return envContent.replace(/(DATABASE_URL=postgresql:\/\/[^/]+\/)([^?\n]+)/, `$1${newDbName}`)
}

function extractDatabaseName(envContent: string): string | null {
  // Extract database name from DATABASE_URL
  // Format: postgresql://user:pass@host:port/dbname
  const match = envContent.match(/DATABASE_URL=postgresql:\/\/[^/]+\/([^?\n]+)/)
  return match ? match[1] : null
}

async function findPostgresContainer(): Promise<string | null> {
  // Find running postgres container by name pattern (works regardless of which worktree started it)
  const result = await $`docker ps --format '{{.Names}}' --filter 'name=postgres'`.quiet().nothrow()
  const containers = result.stdout.toString().trim().split("\n").filter(Boolean)

  // Prefer threa-postgres container (e.g., threa-postgres-1) over other postgres containers (e.g., langfuse)
  const threaContainer = containers.find((c) => c.startsWith("threa-postgres"))
  return threaContainer || containers[0] || null
}

async function createDatabaseIfNotExists(dbName: string): Promise<void> {
  console.log(`Checking if database '${dbName}' exists...`)

  const container = await findPostgresContainer()
  if (!container) {
    throw new Error("No running postgres container found. Run 'bun run db:start' from the main worktree first.")
  }

  console.log(`Using postgres container: ${container}`)

  // Connect to postgres (not a specific database) to create the new database
  const checkResult =
    await $`docker exec ${container} psql -U threa -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${dbName}'"`
      .quiet()
      .nothrow()

  if (checkResult.stdout.toString().trim() === "1") {
    console.log(`Database '${dbName}' already exists`)
    return
  }

  console.log(`Creating database '${dbName}'...`)
  await $`docker exec ${container} psql -U threa -d postgres -c "CREATE DATABASE ${dbName}"`
  console.log(`Database '${dbName}' created`)
}

async function cloneDatabase(container: string, sourceDb: string, targetDb: string): Promise<void> {
  console.log(`Cloning database '${sourceDb}' to '${targetDb}'...`)

  // Use pg_dump piped to psql for the clone
  const result = await $`docker exec ${container} sh -c "pg_dump -U threa ${sourceDb} | psql -U threa ${targetDb}"`
    .quiet()
    .nothrow()

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString()
    // Ignore "already exists" errors for things like extensions
    if (!stderr.includes("already exists")) {
      console.warn("Clone had warnings:", stderr)
    }
  }

  // Sync sequences with actual data (pg_dump doesn't update sequence counters)
  console.log("Syncing sequences...")
  await $`docker exec ${container} psql -U threa ${targetDb} -c "SELECT setval('outbox_id_seq', COALESCE((SELECT MAX(id) FROM outbox), 0) + 1, false)"`
    .quiet()
    .nothrow()

  console.log(`Database '${targetDb}' cloned from '${sourceDb}'`)
}

function copyMcpServers(mainWorktreePath: string, targetWorktreePath: string): void {
  const claudeConfigPath = path.join(os.homedir(), ".claude.json")

  if (!fs.existsSync(claudeConfigPath)) {
    console.log("No ~/.claude.json found, skipping MCP server setup")
    return
  }

  console.log("Copying MCP server configuration...")

  const config: ClaudeConfig = JSON.parse(fs.readFileSync(claudeConfigPath, "utf-8"))

  if (!config.projects) {
    console.log("No projects in ~/.claude.json, skipping MCP server setup")
    return
  }

  const mainProjectConfig = config.projects[mainWorktreePath]
  if (!mainProjectConfig?.mcpServers || Object.keys(mainProjectConfig.mcpServers).length === 0) {
    console.log("No MCP servers configured in main worktree, skipping")
    return
  }

  // Initialize target project config if it doesn't exist
  if (!config.projects[targetWorktreePath]) {
    config.projects[targetWorktreePath] = {}
  }

  // Copy MCP server configuration
  config.projects[targetWorktreePath].mcpServers = { ...mainProjectConfig.mcpServers }
  config.projects[targetWorktreePath].enabledMcpjsonServers = mainProjectConfig.enabledMcpjsonServers || []
  config.projects[targetWorktreePath].disabledMcpjsonServers = mainProjectConfig.disabledMcpjsonServers || []
  config.projects[targetWorktreePath].hasTrustDialogAccepted = mainProjectConfig.hasTrustDialogAccepted

  fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2))

  const serverCount = Object.keys(mainProjectConfig.mcpServers).length
  const serverNames = Object.keys(mainProjectConfig.mcpServers).join(", ")
  console.log(`Copied ${serverCount} MCP server(s): ${serverNames}`)
}

async function main() {
  const cwd = process.cwd()
  console.log(`Setting up worktree at: ${cwd}`)

  // Step 1: Get worktree info
  const worktrees = await getWorktrees()
  const currentWorktree = worktrees.find((w) => w.path === cwd)
  const mainWorktree = getMainWorktree(worktrees)

  if (!mainWorktree) {
    console.error("Could not find main worktree")
    process.exit(1)
  }

  const isMainWorktree = currentWorktree?.isMain || mainWorktree.path === cwd
  if (isMainWorktree) {
    console.log("This appears to be the main worktree. No special setup needed.")
    console.log("Running bun install...")
    await $`bun install`
    console.log("Done!")
    process.exit(0)
  }

  console.log(`Main worktree: ${mainWorktree.path}`)

  // Step 2: Run bun install
  console.log("Installing dependencies...")
  await $`bun install`

  // Step 3: Copy .env from main worktree
  const sourceEnvPath = path.join(mainWorktree.path, "apps/backend/.env")
  const targetEnvPath = path.join(cwd, "apps/backend/.env")

  if (!fs.existsSync(sourceEnvPath)) {
    console.error(`No .env file found at ${sourceEnvPath}`)
    console.log("Please ensure the main worktree has apps/backend/.env configured")
    process.exit(1)
  }

  console.log(`Copying .env from ${sourceEnvPath}...`)
  const originalEnvContent = fs.readFileSync(sourceEnvPath, "utf-8")

  // Extract source database name before modifying
  const sourceDbName = extractDatabaseName(originalEnvContent)
  if (!sourceDbName) {
    console.error("Could not extract database name from main worktree's .env")
    process.exit(1)
  }

  // Step 4: Derive database name from directory
  const dbName = deriveDatabaseName(cwd)
  console.log(`Database name for this worktree: ${dbName}`)
  console.log(`Source database to clone: ${sourceDbName}`)

  // Step 5: Update DATABASE_URL
  const envContent = updateDatabaseUrl(originalEnvContent, dbName)

  // Write the modified .env
  fs.writeFileSync(targetEnvPath, envContent)
  console.log(`Created ${targetEnvPath}`)

  // Step 6: Create database and clone data from main worktree
  try {
    const container = await findPostgresContainer()
    if (!container) {
      throw new Error("No running postgres container found")
    }

    await createDatabaseIfNotExists(dbName)
    await cloneDatabase(container, sourceDbName, dbName)
  } catch (err) {
    console.warn("Could not create/clone database - ensure docker is running and postgres is started")
    console.warn("Run 'bun run db:start' from the main worktree, then run this script again")
  }

  // Step 7: Copy MCP server configuration from main worktree
  try {
    copyMcpServers(mainWorktree.path, cwd)
  } catch (err) {
    console.warn("Could not copy MCP server configuration:", err)
  }

  console.log("\nWorktree setup complete!")
  console.log("\nNext steps:")
  console.log("  1. Ensure postgres is running: bun run db:start")
  console.log("  2. Start development: bun run dev")
}

main().catch((err) => {
  console.error("Setup failed:", err)
  process.exit(1)
})
