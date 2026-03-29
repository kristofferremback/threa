---
name: github-api-web
description: >-
  Navigate the GitHub API using curl when gh CLI is unavailable (Claude Code web sessions).
  Use when gh commands fail with "command not found" and you need to interact with GitHub PRs, issues, or repos.
  ALSO USE THIS when you need to troubleshoot CI failures, fetch GitHub Actions job logs, or debug workflow runs.
  When a check run fails, ALWAYS fetch the logs using this skill before speculating about the cause.
---

# GitHub API via curl (Web Sessions)

In Claude Code web sessions, the `gh` CLI is not installed. Use `curl` with the `$GH_TOKEN` environment variable to interact with the GitHub API directly.

## Setup

The token and repo info are available from the environment:

```bash
# Token is pre-set
echo $GH_TOKEN

# Extract owner/repo from git remote
REMOTE_URL=$(git remote get-url origin)
# Format: http://local_proxy@127.0.0.1:PORT/git/OWNER/REPO
OWNER=$(echo "$REMOTE_URL" | sed 's|.*/git/||' | cut -d/ -f1)
REPO=$(echo "$REMOTE_URL" | sed 's|.*/git/||' | cut -d/ -f2)
```

## Common Headers

All requests need:

```bash
-H "Authorization: token $GH_TOKEN" -H "Content-Type: application/json"
```

## REST API Recipes

### Get PR number from current branch

```bash
BRANCH=$(git branch --show-current)
curl -s -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/pulls?state=open&head=$OWNER:$BRANCH" \
  | python3 -c "import sys,json; prs=json.load(sys.stdin); print(prs[0]['number'] if prs else 'none')"
```

### Fetch inline review comments on a PR

```bash
curl -s -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/pulls/$PR/comments?per_page=100" \
  | python3 -c "
import sys, json
for c in json.load(sys.stdin):
    print(f'--- {c[\"user\"][\"login\"]} | {c[\"path\"]}:{c.get(\"line\",\"?\")} | ID:{c[\"id\"]} ---')
    print(c['body'][:500])
    print()
"
```

### Fetch issue-level comments on a PR

```bash
curl -s -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/issues/$PR/comments?per_page=100" \
  | python3 -c "
import sys, json
for c in json.load(sys.stdin):
    print(f'--- {c[\"user\"][\"login\"]} ---')
    print(c['body'][:500])
    print()
"
```

### Create a PR

```bash
curl -s -H "Authorization: token $GH_TOKEN" \
  -X POST "https://api.github.com/repos/$OWNER/$REPO/pulls" \
  -d "$(python3 -c "
import json
print(json.dumps({
    'title': 'PR title here',
    'body': 'PR body here',
    'head': '$BRANCH',
    'base': 'main'
}))
")"
```

### Update a PR description

```bash
curl -s -H "Authorization: token $GH_TOKEN" \
  -X PATCH "https://api.github.com/repos/$OWNER/$REPO/pulls/$PR" \
  -d "$(python3 -c "
import json
body = open('/tmp/claude/pr-body.md').read()
print(json.dumps({'body': body}))
")"
```

## GraphQL API Recipes

### Fetch review threads with resolution status

```bash
curl -s -H "Authorization: token $GH_TOKEN" \
  -X POST "https://api.github.com/graphql" \
  -d "$(python3 -c "
import json
query = '''query {
  repository(owner: \"$OWNER\", name: \"$REPO\") {
    pullRequest(number: $PR) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          comments(first: 10) {
            nodes {
              author { login }
              body
              path
              line
              createdAt
              updatedAt
            }
          }
        }
      }
    }
  }
}'''
print(json.dumps({'query': query}))
")"
```

### Reply to a review thread

Write the response to a temp file first (avoids heredoc/escaping issues):

```bash
mkdir -p /tmp/claude

printf '%s\n' \
  'Response body here.' \
  '' \
  '🤖 _Response by [Claude Code](https://claude.com/claude-code)_' \
  > /tmp/claude/pr-comment.md

curl -s -H "Authorization: token $GH_TOKEN" \
  -X POST "https://api.github.com/graphql" \
  -d "$(python3 -c "
import json
body = open('/tmp/claude/pr-comment.md').read()
query = '''mutation(\$body: String!) {
  addPullRequestReviewThreadReply(input: {
    pullRequestReviewThreadId: \"THREAD_ID_HERE\"
    body: \$body
  }) {
    comment { id }
  }
}'''
print(json.dumps({'query': query, 'variables': {'body': body}}))
")"

rm /tmp/claude/pr-comment.md
```

### Resolve a review thread

```bash
curl -s -H "Authorization: token $GH_TOKEN" \
  -X POST "https://api.github.com/graphql" \
  -d "{\"query\":\"mutation { resolveReviewThread(input: { threadId: \\\"THREAD_ID_HERE\\\" }) { thread { isResolved } } }\"}"
```

### Post an issue-level comment on a PR

```bash
printf '%s\n' 'Comment body here.' > /tmp/claude/pr-comment.md

curl -s -H "Authorization: token $GH_TOKEN" \
  -X POST "https://api.github.com/repos/$OWNER/$REPO/issues/$PR/comments" \
  -d "$(python3 -c "
import json
body = open('/tmp/claude/pr-comment.md').read()
print(json.dumps({'body': body}))
")"
```

## CI/CD Troubleshooting

**IMPORTANT**: When a GitHub Actions check run fails, ALWAYS fetch the logs before guessing at the cause. Do not speculate — read the logs first.

### Get failed check runs for a PR

Use the MCP tool `mcp__github__pull_request_read` with `method: "get_check_runs"` to list all check runs. Then for any failed jobs, fetch logs using the job ID.

### Fetch job logs by job ID

The job ID is available from `get_check_runs` results (the `id` field). The logs endpoint returns plain text:

```bash
# Fetch full logs for a job (returns plain text, can be very large)
curl -s -L -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/actions/jobs/$JOB_ID/logs"
```

### Fetch only the tail of job logs (recommended)

Job logs can be very large. Pipe through `tail` to get the relevant failure output:

```bash
# Last 80 lines — usually enough to see the error
curl -s -L -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/actions/jobs/$JOB_ID/logs" \
  | tail -80
```

### Search job logs for errors

```bash
# Find lines containing error/failure messages
curl -s -L -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/actions/jobs/$JOB_ID/logs" \
  | grep -i -A 5 'error\|failed\|fatal\|exception'
```

### List workflow runs for a PR branch

```bash
BRANCH=$(git branch --show-current)
curl -s -H "Authorization: token $GH_TOKEN" \
  "https://api.github.com/repos/$OWNER/$REPO/actions/runs?branch=$BRANCH&per_page=5" \
  | python3 -c "
import sys, json
runs = json.load(sys.stdin)['workflow_runs']
for r in runs:
    print(f'{r[\"id\"]} | {r[\"name\"]} | {r[\"status\"]} / {r[\"conclusion\"]} | {r[\"created_at\"]}')
"
```

### Re-run failed jobs in a workflow run

```bash
curl -s -H "Authorization: token $GH_TOKEN" \
  -X POST "https://api.github.com/repos/$OWNER/$REPO/actions/runs/$RUN_ID/rerun-failed-jobs"
```

## Tips

- **Always use `python3 -c` for JSON construction** — avoids shell escaping nightmares with quotes in PR bodies and comment text.
- **Write long content to temp files first** (`/tmp/claude/`), then read with `open().read()` in the python3 JSON builder.
- **Parse responses with python3** for reliable JSON handling: `python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin), indent=2))"`.
- **Pagination**: GitHub defaults to 30 items. Use `?per_page=100` for up to 100. For more, follow `Link` headers.
- **Rate limits**: 5000 requests/hour with token auth. Check with `curl -s -H "Authorization: token $GH_TOKEN" https://api.github.com/rate_limit`.
