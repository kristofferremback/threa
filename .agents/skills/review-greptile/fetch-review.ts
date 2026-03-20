/**
 * Fetches and structures Greptile review data for a PR.
 *
 * Usage: bun .agents/skills/review-greptile/fetch-review.ts [--pr <number>]
 *
 * Outputs JSON with summary comment, inline comments, staleness info,
 * and decoded "Fix with Claude" prompt.
 *
 * Requires `gh` CLI to be authenticated.
 */

const GREPTILE_BOT = "greptile-apps[bot]"

// --- GitHub helpers using `gh` CLI ---

async function gh(args: string[]): Promise<string> {
  const proc = Bun.spawn(["gh", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = await new Response(proc.stdout).text()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`gh ${args.join(" ")} failed (exit ${exitCode}): ${stderr}`)
  }
  return stdout.trim()
}

async function ghJson<T>(args: string[]): Promise<T> {
  const raw = await gh(args)
  return JSON.parse(raw) as T
}

async function ghPaginate<T>(endpoint: string): Promise<T[]> {
  const raw = await gh(["api", "--paginate", endpoint])
  // --paginate concatenates JSON arrays, so we may get multiple arrays
  // Parse carefully: if it's a single array, use it; otherwise merge
  try {
    return JSON.parse(raw) as T[]
  } catch {
    // Multiple concatenated arrays — wrap in brackets and join
    const fixed = "[" + raw.replace(/\]\s*\[/g, ",") + "]"
    return JSON.parse(fixed) as T[]
  }
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

// --- Core logic ---

async function detectPR(): Promise<{ pr: number; owner: string; repo: string }> {
  const [prNum, owner, repo] = await Promise.all([
    gh(["pr", "view", "--json", "number", "-q", ".number"]),
    gh(["repo", "view", "--json", "owner", "-q", ".owner.login"]),
    gh(["repo", "view", "--json", "name", "-q", ".name"]),
  ])
  return { pr: parseInt(prNum, 10), owner, repo }
}

async function checkReviewStatus(
  owner: string,
  repo: string,
  pr: number,
): Promise<ReviewData["reviewStatus"]> {
  // Get the latest commit SHA on the PR to check its status
  const prData = await ghJson<{ headRefOid: string }>(["pr", "view", String(pr), "--json", "headRefOid"])
  const checkRuns = await ghJson<{ check_runs: CheckRun[] }>([
    "api",
    `repos/${owner}/${repo}/commits/${prData.headRefOid}/check-runs`,
  ])
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
  const comments = await ghPaginate<GitHubComment>(
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
  const comments = await ghPaginate<InlineComment>(
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

  const commits = await ghPaginate<Commit>(
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
      const detail = await ghJson<CommitDetail>([
        "api",
        `repos/${owner}/${repo}/commits/${c.sha}`,
      ])
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
    ;[owner, repo] = await Promise.all([
      gh(["repo", "view", "--json", "owner", "-q", ".owner.login"]),
      gh(["repo", "view", "--json", "name", "-q", ".name"]),
    ])
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
