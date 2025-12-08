import { $ } from "bun"

async function waitForPostgres(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result =
        await $`docker compose exec -T postgres pg_isready -U threa -d threa`.quiet()
      if (result.exitCode === 0) {
        return true
      }
    } catch {
      // Container not ready yet
    }
    await Bun.sleep(1000)
  }
  return false
}

async function main() {
  console.log("Ensuring PostgreSQL is running...")
  await $`docker compose up -d postgres`

  console.log("Waiting for PostgreSQL to be ready...")
  const ready = await waitForPostgres()
  if (!ready) {
    console.error("PostgreSQL failed to start")
    process.exit(1)
  }
  console.log("PostgreSQL is ready")

  console.log("Starting backend and frontend...")

  const backend = Bun.spawn(["bun", "--hot", "apps/backend/src/index.ts"], {
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: "postgresql://threa:threa@localhost:5454/threa",
      USE_STUB_AUTH: process.env.USE_STUB_AUTH ?? "true",
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
