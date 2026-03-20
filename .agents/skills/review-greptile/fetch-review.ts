/**
 * Fetches and structures Greptile review data for a PR.
 *
 * Usage: bun .agents/skills/review-greptile/fetch-review.ts [--pr <number>]
 *
 * Outputs JSON with summary comment, inline comments, staleness info,
 * and decoded "Fix with Claude" prompt.
 *
 * Auth resolution order:
 *   1. `gh` CLI (if installed and authenticated)
 *   2. `GH_TOKEN` environment variable with native fetch()
 *   3. Token extracted from `gh auth token` with native fetch()
 */

const GREPTILE_BOT = "greptile-apps[bot]"

// --- GitHub access layer ---
// Detects whether `gh` CLI is available and falls back to fetch() + token.

let _mode: "gh" | "fetch" | undefined
let _token: string | undefined

async function hasGhCli(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["gh", "--version"], { stdout: "pipe", stderr: "pipe" })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
}

async function resolveToken(): Promise<string> {
  // Try GH_TOKEN env first
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN

  // Try extracting from gh CLI auth store
  try {
    const proc = Bun.spawn(["gh", "auth", "token"], { stdout: "pipe", stderr: "pipe" })
    const stdout = await new Response(proc.stdout).text()
    await proc.exited
    if (proc.exitCode === 0 && stdout.trim()) return stdout.trim()
  } catch {
    // gh not available
  }

  throw new Error(
    "No GitHub auth found. Install `gh` CLI and run `gh auth login`, or set GH_TOKEN env var.",
  )
}

async function initMode(): Promise<void> {
  if (_mode) return
  if (await hasGhCli()) {
    _mode = "gh"
  } else {
    _token = await resolveToken()
    _mode = "fetch"
  }
}

// --- gh CLI helpers ---

async function ghExec(args: string[]): Promise<string> {
  const proc = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "pipe" })
  const stdout = await new Response(proc.stdout).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`gh ${args.join(" ")} failed (exit ${exitCode}): ${stderr}`)
  }
  return stdout.trim()
}

// --- fetch() helpers ---

async function githubFetch(endpoint: string): Promise<unknown> {
  const url = endpoint.startsWith("https://")
    ? endpoint
    : `https://api.github.com/${endpoint}`
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${_token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })
  if (!resp.ok) {
    throw new Error(`GitHub API ${endpoint} failed (${resp.status}): ${await resp.text()}`)
  }
  return resp.json()
}

async function githubFetchPaginated<T>(endpoint: string): Promise<T[]> {
  const results: T[] = []
  let url: string | null = endpoint.startsWith("https://")
    ? endpoint
    : `https://api.github.com/${endpoint}?per_page=100`

  while (url) {
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${_token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })
    if (!resp.ok) {
      throw new Error(`GitHub API ${url} failed (${resp.status}): ${await resp.text()}`)
    }
    const page = (await resp.json()) as T[]
    results.push(...page)

    // Parse Link header for next page
    const link = resp.headers.get("link")
    const next = link?.match(/<([^>]+)>;\s*rel="next"/)
    url = next ? next[1] : null
  }
  return results
}

// --- Unified API layer ---

async function gh(args: string[]): Promise<string> {
  await initMode()
  if (_mode === "gh") {
    return ghExec(args)
  }
  throw new Error(`gh() called in fetch mode — use apiGet/apiPaginate instead`)
}

async function ghJson<T>(args: string[]): Promise<T> {
  await initMode()
  if (_mode === "gh") {
    const raw = await ghExec(args)
    return JSON.parse(raw) as T
  }

  // Translate common gh CLI patterns to fetch calls
  // gh api <endpoint>
  if (args[0] === "api") {
    const endpoint = args.filter((a) => !a.startsWith("--"))[1]
    return (await githubFetch(endpoint)) as T
  }
  // gh pr view <num> --json <field>
  if (args[0] === "pr" && args[1] === "view") {
    const prNum = args[2]
    const jsonIdx = args.indexOf("--json")
    const fields = jsonIdx !== -1 ? args[jsonIdx + 1] : ""
    const { owner, repo } = await detectOwnerRepo()
    const pr = (await githubFetch(`repos/${owner}/${repo}/pulls/${prNum}`)) as Record<string, unknown>
    // Map common fields
    const result: Record<string, unknown> = {}
    for (const field of fields.split(",")) {
      if (field === "number") result.number = pr.number
      if (field === "headRefOid") result.headRefOid = (pr.head as { sha: string }).sha
    }
    return result as T
  }
  throw new Error(`Unsupported gh command in fetch mode: ${args.join(" ")}`)
}

async function apiPaginate<T>(endpoint: string): Promise<T[]> {
  await initMode()
  if (_mode === "gh") {
    const raw = await ghExec(["api", "--paginate", endpoint])
    try {
      return JSON.parse(raw) as T[]
    } catch {
      const fixed = raw.replace(/\]\s*\[/g, ",")
      return JSON.parse(fixed) as T[]
    }
  }
  return githubFetchPaginated<T>(endpoint)
}

async function apiGet<T>(endpoint: string): Promise<T> {
  await initMode()
  if (_mode === "gh") {
    return JSON.parse(await ghExec(["api", endpoint])) as T
  }
  return (await githubFetch(endpoint)) as T
}

// --- Types ---

interface GitHubComment {
  id: number
  body: string
  created_at: string
  updated_at: string
  user: { login: string }
}

interface InlineComment {
  id: number
  path: string
  line: number | null
  body: string
  created_at: string
  user: { login: string }
}

interface Commit {
  sha: string
  commit: {
    committer: { date: string }
    message: string
  }
}

interface CommitDetail {
  files: Array<{ filename: string }>
}

interface CheckRun {
  name: string
  status: string
  conclusion: string | null
}

interface ReviewData {
  pr: number
  owner: string
  repo: string
  reviewStatus: { name: string; status: string; conclusion: string | null } | null
  summary: {
    body: string
    confidenceScore: string | null
    fixUrl: string | null
    decodedPrompt: string | null
  } | null
  inlineComments: Array<{
    id: number
    path: string
    line: number | null
    body: string
    created_at: string
  }>
  staleness: {
    lastReviewTimestamp: string | null
    filesChangedAfterReview: string[]
  }
}

// --- Owner/repo detection ---

let _ownerRepo: { owner: string; repo: string } | undefined

async function detectOwnerRepo(): Promise<{ owner: string; repo: string }> {
  if (_ownerRepo) return _ownerRepo

  await initMode()
  if (_mode === "gh") {
    const [owner, repo] = await Promise.all([
      ghExec(["repo", "view", "--json", "owner", "-q", ".owner.login"]),
      ghExec(["repo", "view", "--json", "name", "-q", ".name"]),
    ])
    _ownerRepo = { owner, repo }
    return _ownerRepo
  }

  // Parse from git remote
  const proc = Bun.spawn(["git", "remote", "get-url", "origin"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const url = (await new Response(proc.stdout).text()).trim()
  await proc.exited

  // Handle SSH (git@github.com:owner/repo.git), HTTPS (https://github.com/owner/repo.git),
  // and proxy URLs (http://proxy@host/git/owner/repo)
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/) ?? url.match(/\/git\/([^/]+)\/([^/.]+)/)
  if (!match) throw new Error(`Could not parse owner/repo from git remote: ${url}`)

  _ownerRepo = { owner: match[1], repo: match[2] }
  return _ownerRepo
}

// --- Core logic ---

async function detectPR(): Promise<{ pr: number; owner: string; repo: string }> {
  await initMode()
  const { owner, repo } = await detectOwnerRepo()

  if (_mode === "gh") {
    const prNum = await ghExec(["pr", "view", "--json", "number", "-q", ".number"])
    return { pr: parseInt(prNum, 10), owner, repo }
  }

  // In fetch mode, detect current branch and find its PR
  const branchProc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const branch = (await new Response(branchProc.stdout).text()).trim()
  await branchProc.exited

  const prs = (await githubFetch(
    `repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=open`,
  )) as Array<{ number: number }>

  if (prs.length === 0) {
    throw new Error(`No open PR found for branch ${branch}. Use --pr <number> to specify.`)
  }
  return { pr: prs[0].number, owner, repo }
}

async function checkReviewStatus(
  owner: string,
  repo: string,
  pr: number,
): Promise<ReviewData["reviewStatus"]> {
  const prData = await ghJson<{ headRefOid: string }>(["pr", "view", String(pr), "--json", "headRefOid"])
  const checkRuns = await apiGet<{ check_runs: CheckRun[] }>(
    `repos/${owner}/${repo}/commits/${prData.headRefOid}/check-runs`,
  )
  const greptile = checkRuns.check_runs.find((cr) =>
    cr.name.toLowerCase().includes("greptile"),
  )
  return greptile
    ? { name: greptile.name, status: greptile.status, conclusion: greptile.conclusion }
    : null
}

async function fetchSummaryComment(
  owner: string,
  repo: string,
  pr: number,
): Promise<ReviewData["summary"]> {
  const comments = await apiPaginate<GitHubComment>(
    `repos/${owner}/${repo}/issues/${pr}/comments`,
  )
  const greptileComments = comments.filter((c) => c.user.login === GREPTILE_BOT)
  if (greptileComments.length === 0) return null

  const latest = greptileComments[greptileComments.length - 1]
  const body = latest.body

  // Extract confidence score
  const scoreMatch = body.match(/Confidence Score:\s*(\d+\/\d+)/)
  const confidenceScore = scoreMatch ? scoreMatch[1] : null

  // Extract Fix with Claude URL and decode prompt
  const urlMatch = body.match(/https:\/\/app\.greptile\.com\/ide\/claude-code\S+/)
  let fixUrl: string | null = null
  let decodedPrompt: string | null = null

  if (urlMatch) {
    fixUrl = urlMatch[0].replace(/\)$/, "") // strip trailing markdown paren
    try {
      const parsed = new URL(fixUrl)
      decodedPrompt = parsed.searchParams.get("prompt")
    } catch {
      // URL parsing failed — leave null
    }
  }

  return { body, confidenceScore, fixUrl, decodedPrompt }
}

async function fetchInlineComments(
  owner: string,
  repo: string,
  pr: number,
): Promise<ReviewData["inlineComments"]> {
  const comments = await apiPaginate<InlineComment>(
    `repos/${owner}/${repo}/pulls/${pr}/comments`,
  )
  return comments
    .filter((c) => c.user.login === GREPTILE_BOT)
    .map((c) => ({
      id: c.id,
      path: c.path,
      line: c.line,
      body: c.body,
      created_at: c.created_at,
    }))
}

async function checkStaleness(
  owner: string,
  repo: string,
  pr: number,
  inlineComments: ReviewData["inlineComments"],
): Promise<ReviewData["staleness"]> {
  if (inlineComments.length === 0) {
    return { lastReviewTimestamp: null, filesChangedAfterReview: [] }
  }

  const lastReviewTimestamp = inlineComments[inlineComments.length - 1].created_at

  const commits = await apiPaginate<Commit>(
    `repos/${owner}/${repo}/pulls/${pr}/commits`,
  )
  const postReviewCommits = commits.filter(
    (c) => c.commit.committer.date > lastReviewTimestamp,
  )

  if (postReviewCommits.length === 0) {
    return { lastReviewTimestamp, filesChangedAfterReview: [] }
  }

  // Fetch changed files for each post-review commit in parallel
  const fileArrays = await Promise.all(
    postReviewCommits.map(async (c) => {
      const detail = await apiGet<CommitDetail>(
        `repos/${owner}/${repo}/commits/${c.sha}`,
      )
      return detail.files.map((f) => f.filename)
    }),
  )

  const filesChangedAfterReview = [...new Set(fileArrays.flat())].sort()
  return { lastReviewTimestamp, filesChangedAfterReview }
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2)
  const prArgIndex = args.indexOf("--pr")

  let pr: number
  let owner: string
  let repo: string

  if (prArgIndex !== -1 && args[prArgIndex + 1]) {
    pr = parseInt(args[prArgIndex + 1], 10)
    ;({ owner, repo } = await detectOwnerRepo())
  } else {
    ;({ pr, owner, repo } = await detectPR())
  }

  // Run independent fetches in parallel
  const [reviewStatus, summary, inlineComments] = await Promise.all([
    checkReviewStatus(owner, repo, pr),
    fetchSummaryComment(owner, repo, pr),
    fetchInlineComments(owner, repo, pr),
  ])

  // Staleness depends on inline comments
  const staleness = await checkStaleness(owner, repo, pr, inlineComments)

  const result: ReviewData = {
    pr,
    owner,
    repo,
    reviewStatus,
    summary,
    inlineComments,
    staleness,
  }

  console.log(JSON.stringify(result, null, 2))
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
