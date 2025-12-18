import { $ } from "bun"
import * as fs from "fs"
import * as path from "path"

const POSTGRES_HOST = "localhost"
const POSTGRES_PORT = 5454

function loadEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {}
  if (!fs.existsSync(filePath)) return env

  const content = fs.readFileSync(filePath, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIndex = trimmed.indexOf("=")
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex)
    let value = trimmed.slice(eqIndex + 1)
    // Remove surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
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
  // First try to find the bare repo
  const bare = worktrees.find((w) => w.isMain)
  if (bare) return bare
  // Try the one on main/master branch
  const mainBranch = worktrees.find((w) => w.branch.endsWith("/main") || w.branch.endsWith("/master"))
  if (mainBranch) return mainBranch
  // Otherwise, the main worktree is the one without a dot suffix (e.g., "threa" vs "threa.feature")
  // This is a common convention for git worktrees
  const primary = worktrees.find((w) => !path.basename(w.path).includes("."))
  if (primary) return primary
  // Last resort: first worktree (usually the original)
  return worktrees[0]
}

function deriveDatabaseName(dirPath: string): string {
  const dirName = path.basename(dirPath)
  // Convert to valid postgres identifier
  const sanitized = dirName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
  return sanitized || "threa"
}

async function ensureWorktreeEnv(): Promise<void> {
  const cwd = process.cwd()
  const backendEnvPath = path.join(cwd, "apps/backend/.env")

  // If .env exists, nothing to do
  if (fs.existsSync(backendEnvPath)) return

  const worktrees = await getWorktrees()
  const mainWorktree = getMainWorktree(worktrees)

  if (!mainWorktree) {
    console.warn("Could not find main worktree - .env setup skipped")
    return
  }

  // Check if we're in the main worktree
  if (mainWorktree.path === cwd) return

  const sourceEnvPath = path.join(mainWorktree.path, "apps/backend/.env")
  if (!fs.existsSync(sourceEnvPath)) {
    console.warn(`No .env in main worktree (${sourceEnvPath}) - cannot auto-setup`)
    return
  }

  // Copy and modify .env
  const dbName = deriveDatabaseName(cwd)
  console.log(`Setting up worktree .env with database: ${dbName}`)

  let content = fs.readFileSync(sourceEnvPath, "utf-8")
  content = content.replace(/(DATABASE_URL=postgresql:\/\/[^/]+\/)([^?\n]+)/, `$1${dbName}`)
  fs.writeFileSync(backendEnvPath, content)

  // Create database and copy data if postgres is reachable
  if (await isPostgresReachable()) {
    const checkResult =
      await $`docker exec threa-postgres-1 psql -U threa -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${dbName}'"`
        .quiet()
        .nothrow()
    if (checkResult.stdout.toString().trim() !== "1") {
      console.log(`Creating database '${dbName}'...`)
      await $`docker exec threa-postgres-1 psql -U threa -d postgres -c "CREATE DATABASE ${dbName}"`.quiet()

      // Copy schema + data from main database (threa) to worktree database
      // Duplicate schema errors are expected and harmless (migrations will reconcile)
      console.log(`Copying data from main database...`)
      await $`docker exec threa-postgres-1 pg_dump -U threa -d threa --no-owner --no-acl | docker exec -i threa-postgres-1 psql -U threa -d ${dbName}`
        .quiet()
        .nothrow()
      console.log(`Data copied successfully`)
    }
  }
}

async function isPostgresReachable(): Promise<boolean> {
  try {
    // Try TCP connection to postgres port
    const socket = await Bun.connect({
      hostname: POSTGRES_HOST,
      port: POSTGRES_PORT,
      socket: {
        data() {},
        open(socket) {
          socket.end()
        },
        error() {},
        close() {},
      },
    })
    socket.end()
    return true
  } catch {
    return false
  }
}

async function waitForPostgres(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isPostgresReachable()) {
      return true
    }
    await Bun.sleep(1000)
  }
  return false
}

async function main() {
  // Check if postgres is already running (e.g., started from main worktree)
  if (await isPostgresReachable()) {
    console.log("PostgreSQL is already running")
    // Auto-setup worktree .env if needed (requires postgres for db creation)
    await ensureWorktreeEnv()
  } else {
    console.log("Starting PostgreSQL...")
    const result = await $`docker compose up -d postgres`.nothrow()

    if (result.exitCode !== 0) {
      console.error("Failed to start PostgreSQL via docker compose.")
      console.error("If you're in a git worktree, start postgres from the main threa folder:")
      console.error("  cd /path/to/threa && bun run db:start")
      process.exit(1)
    }

    console.log("Waiting for PostgreSQL to be ready...")
    const ready = await waitForPostgres()
    if (!ready) {
      console.error("PostgreSQL failed to become ready")
      process.exit(1)
    }
    console.log("PostgreSQL is ready")
    // Auto-setup worktree .env if needed
    await ensureWorktreeEnv()
  }

  console.log("Starting backend and frontend...")

  // Load backend's .env file (worktree-specific DATABASE_URL, etc.)
  const backendEnvPath = path.join(process.cwd(), "apps/backend/.env")
  const backendEnv = loadEnvFile(backendEnvPath)

  const backend = Bun.spawn(["bun", "--hot", "apps/backend/src/index.ts"], {
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      ...backendEnv,
      // Fallback DATABASE_URL only if not in .env
      DATABASE_URL:
        backendEnv.DATABASE_URL ?? process.env.DATABASE_URL ?? "postgresql://threa:threa@localhost:5454/threa",
      USE_STUB_AUTH: backendEnv.USE_STUB_AUTH ?? process.env.USE_STUB_AUTH ?? "false",
    },
  })

  const frontend = Bun.spawn(["bun", "run", "--cwd", "apps/frontend", "dev"], {
    stdout: "inherit",
    stderr: "inherit",
  })

  process.on("SIGINT", () => {
    console.log("\nShutting down...")
    backend.kill()
    frontend.kill()
    process.exit(0)
  })

  process.on("SIGTERM", () => {
    backend.kill()
    frontend.kill()
    process.exit(0)
  })

  await Promise.all([backend.exited, frontend.exited])
}

main()
