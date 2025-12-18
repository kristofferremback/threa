# PR Review Response

Fetch and respond to review comments on a pull request.

## Arguments

- `$ARGUMENTS` - PR number (optional, defaults to PR for current branch)

## Severity Scale (1-7)

When reviewing code or presenting comments, use this severity scale:

| Rating | Level       | Description                                        | Examples                                                                   |
| ------ | ----------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| **7**  | Critical    | Security vulnerability, data loss, or crash        | SQL injection, auth bypass, unhandled null causing crash                   |
| **6**  | High        | Significant bug or major architectural issue       | Race condition, missing validation on user input, broken business logic    |
| **5**  | Medium-High | Bug that affects functionality but has workarounds | Missing error handling, incorrect edge case behavior                       |
| **4**  | Medium      | Code quality issue that should be fixed            | Missing rate limiting, no input length limits, potential performance issue |
| **3**  | Medium-Low  | Improvement that would make code better            | Missing timeout, could use better abstraction                              |
| **2**  | Low         | Minor suggestion or style preference               | Magic numbers, could extract constant                                      |
| **1**  | Nit         | Trivial, cosmetic, or highly subjective            | Naming preference, comment wording                                         |

**Guidelines:**

- Always include severity rating in review comments
- Prioritize fixing 5+ issues before merging
- 4 and below can be deferred to follow-up PRs
- Be consistent: same issue type = same severity across reviews

## Instructions

1. **Determine the PR number**:
   - If `$ARGUMENTS` is provided and is a number, use that as the PR number
   - Otherwise, detect the PR from the current branch using `gh pr view --json number -q .number`

2. **Fetch all review comments**:

   ```bash
   gh api repos/{owner}/{repo}/pulls/{pr}/comments
   ```

3. **Fetch review threads to check resolution status**:

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

4. **Present the unresolved comments** to the user, grouped by file, showing:
   - File path and line number
   - The comment body (extract the main issue, ignore HTML/markdown badges)
   - Severity if mentioned (High/Medium/Low)

5. **Ask the user** which comments to address (or if they want to address all)

6. **For each comment to address**:
   - Read the relevant file
   - Understand the issue
   - Fix the code if it's a valid bug/improvement
   - Reply to the review thread explaining what was done:
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
   - Resolve the thread:
     ```bash
     gh api graphql -f query='
     mutation {
       resolveReviewThread(input: { threadId: "{thread_id}" }) {
         thread { isResolved }
       }
     }'
     ```

7. **After all fixes**, commit the changes with a descriptive message referencing the PR.

8. **Push the changes** to update the PR.

## Response Format

When presenting comments, use this format:

```
## PR #{number}: {title}

### Unresolved Review Comments ({count})

#### {file_path}:{line}
**Severity**: {1-7} ({level})
**Issue**: {brief description}

---
```

Example:

```
#### src/handlers/auth.ts:45
**Severity**: 6 (High)
**Issue**: Missing authentication check allows unauthorized access

#### src/lib/utils.ts:120
**Severity**: 3 (Medium-Low)
**Issue**: Could add timeout to prevent hanging requests
```

After fixes, summarize:

```
## Fixed Issues

| Severity | File | Issue | Resolution |
|----------|------|-------|------------|
| 6 | src/auth.ts | Missing auth check | Added middleware |
| 3 | src/utils.ts | No timeout | Added 30s timeout |

Committed as {commit_sha} and pushed to PR.
```
