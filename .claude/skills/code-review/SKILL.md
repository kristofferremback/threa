---
name: code-review
description: Run parallel code and security reviews on a PR, posting findings as comments
---

# Parallel Code Review

This skill orchestrates two parallel review agents that analyze a PR and post their findings as comments.

## What It Does

1. Identifies the PR to review (from argument or current branch)
2. Spawns two background agents in parallel:
   - **Code Review Agent**: Runs `/review`, posts findings as PR comment
   - **Security Review Agent**: Runs `/security-review`, posts findings as PR comment
3. Waits for both agents to complete
4. Reports the outcome

## Instructions

### Step 1: Identify and Validate the PR

If a PR number was provided as an argument, use that. Otherwise, find the open PR for the current branch:

```bash
gh pr view --json number,title,url -q '"\(.number)|\(.title)|\(.url)"'
```

This outputs `number|title|url` format. Parse the values from the output.

If no PR exists for the current branch and no number was provided, stop and tell the user:

```
No open PR found for current branch. Please provide a PR number: /code-review <number>
```

**Validate the PR exists** before proceeding. If a PR number was provided as an argument, verify it:

```bash
gh pr view <NUMBER> --json number -q '.number'
```

If this fails, stop and tell the user:

```
PR #<NUMBER> not found. Please check the PR number and try again.
```

### Step 2: Spawn Both Review Agents

Use the Task tool to spawn TWO agents in parallel. Both calls should be in the SAME message to run concurrently.

**CRITICAL**: Set `run_in_background: true` for both agents.

**Note**: In the prompts below, replace `<NUMBER>`, `<TITLE>`, and `<URL>` with actual values from the `gh pr view` output.

**Task IDs**: The Task tool returns a `task_id` for each spawned agent. Capture these IDs from the tool responses - you'll need them in Step 3 to wait for completion.

**Agent 1 - Code Review:**

```
subagent_type: "general-purpose"
description: "Code review PR"
run_in_background: true
prompt: |
  You are a code review agent. Your task:

  1. Run the /review slash command to review PR #<NUMBER>
  2. Format your findings as a well-structured markdown comment
  3. Post the review as a PR comment using a heredoc to handle special characters:
     gh pr comment <NUMBER> --body "$(cat <<'EOF'
     <your review>
     EOF
     )"
  4. If posting fails, retry up to 3 times total before giving up

  PR Details:
  - Number: <NUMBER>
  - Title: <TITLE>
  - URL: <URL>

  Important:
  - Focus on code quality, architecture, and maintainability
  - Be constructive and specific
  - Include code snippets when referencing specific issues
  - End your comment with a clear summary (approve/request changes/comment)

  When done, report: SUCCESS or FAILURE (with reason)
```

**Agent 2 - Security Review:**

```
subagent_type: "general-purpose"
description: "Security review PR"
run_in_background: true
prompt: |
  You are a security review agent. Your task:

  1. Run the /security-review slash command to review PR #<NUMBER>
  2. Format your findings as a well-structured markdown comment
  3. Post the review as a PR comment using a heredoc to handle special characters:
     gh pr comment <NUMBER> --body "$(cat <<'EOF'
     <your review>
     EOF
     )"
  4. If posting fails, retry up to 3 times total before giving up

  PR Details:
  - Number: <NUMBER>
  - Title: <TITLE>
  - URL: <URL>

  Important:
  - Focus on security vulnerabilities, injection risks, auth issues
  - Reference OWASP top 10 where relevant
  - Be specific about risk severity (critical/high/medium/low)
  - Include remediation suggestions
  - End with a security verdict (no issues found/issues found)

  When done, report: SUCCESS or FAILURE (with reason)
```

### Step 3: Wait for Both Agents

Use TaskOutput to wait for each background agent to complete:

```
TaskOutput(task_id: "<agent1_task_id>", block: true, timeout: 300000)
TaskOutput(task_id: "<agent2_task_id>", block: true, timeout: 300000)
```

The 5-minute timeout accounts for large PRs. Both TaskOutput calls can be made in parallel.

**If a timeout occurs**: Report the agent as `TIMEOUT` rather than `FAILED`, and note that the review may still be in progress. The user can check the PR comments manually or re-run the skill.

### Step 4: Report Results

After both agents complete, summarize:

**If both succeeded:**

```
Both reviews posted to PR #<NUMBER>:
- Code review: Posted
- Security review: Posted

View at: <PR_URL>
```

**If one or both failed:**

```
Review results for PR #<NUMBER>:
- Code review: <SUCCESS/FAILED: reason>
- Security review: <SUCCESS/FAILED: reason>

<If any failed>: You may want to run the failed review manually.
```

## Example Usage

**With PR number:**

```
/code-review 72
```

**From current branch:**

```
/code-review
```

## Notes

- Each agent retries posting up to 3 times before reporting failure
- Both agents run to completion independently (no fail-fast)
- Reviews are posted as separate comments, not inline review comments
- The agents have full context of the PR diff via the native slash commands
- **Duplicate runs**: Running `/code-review` multiple times on the same PR will post duplicate comments. There is no deduplication mechanism.
