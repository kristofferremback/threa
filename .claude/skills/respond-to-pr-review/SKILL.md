---
name: respond-to-pr-review
description: Fetch, analyze, and respond to PR review comments. Use when asked to check PR comments, address review feedback, respond to reviewers, or fix issues raised in code reviews.
---

# Respond to PR Review

Fetch and respond to review comments on pull requests.

## Instructions

### 1. Determine PR number

If not provided, detect from current branch:
```bash
gh pr view --json number -q .number
```

### 2. Fetch review comments

```bash
gh api repos/{owner}/{repo}/pulls/{pr}/comments
```

### 3. Fetch review thread IDs and resolution status

```bash
gh api graphql -f query='
query {
  repository(owner: "{owner}", name: "{repo}") {
    pullRequest(number: {pr}) {
      reviewThreads(first: 50) {
        nodes {
          id
          isResolved
          comments(first: 1) {
            nodes {
              body
              path
              line
            }
          }
        }
      }
    }
  }
}'
```

### 4. Present unresolved comments

Summarize each comment showing:
- File path and line number
- The core issue (ignore HTML badges, buttons, metadata)
- Severity if mentioned (High/Medium/Low)

### 5. Verify before fixing

Read the relevant code and verify each issue is valid before fixing.

### 6. Fix and respond

For each valid issue:

1. Fix the code

2. Reply to the thread:
```bash
gh api graphql -f query='
mutation {
  addPullRequestReviewThreadReply(input: {
    pullRequestReviewThreadId: "{thread_id}"
    body: "{response}"
  }) {
    comment { id }
  }
}'
```

3. Resolve the thread:
```bash
gh api graphql -f query='
mutation {
  resolveReviewThread(input: { threadId: "{thread_id}" }) {
    thread { isResolved }
  }
}'
```

### 7. Commit and push

Commit all fixes with a message referencing the review feedback, then push.

## Examples

**User says:** "Check the PR comments"
**Action:** Fetch comments for current branch's PR, present issues, ask which to fix

**User says:** "Address the review feedback on PR 42"
**Action:** Fetch comments for PR #42, fix valid issues, respond and resolve threads

**User says:** "Respond to the reviewers"
**Action:** Reply to review threads explaining fixes, resolve addressed comments
