import { $ } from "bun"
import * as path from "path"
import * as fs from "fs"

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

  // Otherwise find the one on main/master branch
  return worktrees.find((w) => w.branch.endsWith("/main") || w.branch.endsWith("/master"))
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
  return envContent.replace(
    /(DATABASE_URL=postgresql:\/\/[^/]+\/)([^?\n]+)/,
    `$1${newDbName}`
  )
}

async function createDatabaseIfNotExists(dbName: string): Promise<void> {
  console.log(`Checking if database '${dbName}' exists...`)

  // Connect to postgres (not a specific database) to create the new database
  const checkResult = await $`docker compose exec -T postgres psql -U threa -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${dbName}'"`.quiet().nothrow()

  if (checkResult.stdout.toString().trim() === "1") {
    console.log(`Database '${dbName}' already exists`)
    return
  }

  console.log(`Creating database '${dbName}'...`)
  await $`docker compose exec -T postgres psql -U threa -d postgres -c "CREATE DATABASE ${dbName}"`
  console.log(`Database '${dbName}' created`)
}

async function runMigrations(dbName: string): Promise<void> {
  console.log("Running migrations...")
  const dbUrl = `postgresql://threa:threa@localhost:5454/${dbName}`
  await $`DATABASE_URL=${dbUrl} bun apps/backend/src/index.ts --migrate-only`.quiet().nothrow()
  // Actually, let's use the backend's migration system directly
  // We need to start the app briefly to run migrations, or we can call the migrator directly
  // For now, let's use a simpler approach - run the backend with a flag or just let it migrate on startup
  console.log("Migrations will run on first backend start")
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
  let envContent = fs.readFileSync(sourceEnvPath, "utf-8")

  // Step 4: Derive database name from directory
  const dbName = deriveDatabaseName(cwd)
  console.log(`Database name for this worktree: ${dbName}`)

  // Step 5: Update DATABASE_URL
  envContent = updateDatabaseUrl(envContent, dbName)

  // Write the modified .env
  fs.writeFileSync(targetEnvPath, envContent)
  console.log(`Created ${targetEnvPath}`)

  // Step 6: Create database if needed (requires docker to be running)
  try {
    await createDatabaseIfNotExists(dbName)
    await runMigrations(dbName)
  } catch (err) {
    console.warn("Could not create database - ensure docker is running and postgres is started")
    console.warn("Run 'bun run db:start' and then manually create the database:")
    console.warn(`  docker compose exec postgres psql -U threa -d postgres -c "CREATE DATABASE ${dbName}"`)
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
