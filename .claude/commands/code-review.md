---
allowed-tools: Bash(gh issue view:*), Bash(gh search:*), Bash(gh issue list:*), Bash(gh pr comment:*), Bash(gh pr diff:*), Bash(gh pr view:*), Bash(gh pr list:*)
description: Code review a pull request
disable-model-invocation: false
---

Provide a code review for the given pull request.

To do this, follow these steps precisely:

1. Use a Haiku agent to check if the pull request (a) is closed, (b) is a draft, (c) does not need a code review (eg. because it is an automated pull request, or is very simple and obviously ok), or (d) already has a code review from you from earlier. If so, do not proceed.
2. Use another Haiku agent to give you a list of file paths to (but not the contents of) any relevant CLAUDE.md files from the codebase: the root CLAUDE.md file (if one exists), as well as any CLAUDE.md files in the directories whose files the pull request modified
3. Use a Haiku agent to view the pull request, and ask the agent to return a summary of the change
4. Then, launch 6 parallel Sonnet agents to independently code review the change. The agents should do the following, then return a list of issues and the reason each issue was flagged (eg. CLAUDE.md adherence, bug, historical git context, abstraction design, etc.):
   a. Agent #1: Audit the changes to make sure they comply with the CLAUDE.md. Note that CLAUDE.md is guidance for Claude as it writes code, so not all instructions will be applicable during code review.
   b. Agent #2: Read the file changes in the pull request, then do a shallow scan for obvious bugs. Avoid reading extra context beyond the changes, focusing just on the changes themselves. Focus on large bugs, and avoid small issues and nitpicks. Ignore likely false positives. **CRITICAL: Trace the full flow of data through the system - understand how values flow from input to output, not just individual function implementations. Look for issues in the complete data path, not isolated details.**
   c. Agent #3: Read the git blame and history of the code modified, to identify any bugs in light of that historical context. **Focus on understanding the bigger picture: why does this code exist, what problem does it solve, and does the change break that contract?**
   d. Agent #4: Read previous pull requests that touched these files, and check for any comments on those pull requests that may also apply to the current pull request.
   e. Agent #5: Read code comments in the modified files, and make sure the changes in the pull request comply with any guidance in the comments.
   f. Agent #6 (Abstraction Design): **Evaluate the quality of any new or modified APIs, contexts, hooks, or interfaces. Look specifically for:**
      - **Leaky abstractions**: Does the API expose implementation details (multiple correlated booleans, internal state) instead of semantic intent? When you see multiple booleans that consumers must combine, ask: "Do these represent states in a hidden state machine?" If yes, the abstraction should expose the state directly.
      - **Consumer burden**: Do consumers have to understand internal state to use the API correctly? Look for complex boolean combinations like `if (isX && !isY && hasZ)` in consuming code - this pattern suggests the abstraction is forcing consumers to re-derive information it should provide directly.
      - **State machine leakage**: If the code has lifecycle states (loading → ready, draft → published, open → closing → closed), does the API expose the states as a discriminated union/enum, or as primitive booleans that must be combined? Multiple correlated booleans are a code smell.
      - **Next developer test**: Would someone new to the codebase understand how to use this API correctly? If they'd likely get it wrong, the abstraction is leaky.

      **How to evaluate**: Read the API being introduced (context value, hook return, class interface). Then read ALL consumers in the PR, paying close attention to HOW they use the API values. Look for:
      - Complex boolean expressions combining multiple API values with `&&`, `||`, `!`
      - Comments explaining how to correctly combine values ("only check X after Y is true")
      - Similar logic repeated across multiple consumers (the abstraction should encapsulate it)
      - Consumers asking questions like "what state are we in?" by combining primitives

      If consumers are doing complex logic to derive what should be simple answers, that's a leaky abstraction. The fix is usually to expose the semantic answer directly (a discriminated union, an enum, a computed property) rather than the raw ingredients.
5. For each issue found in #4, launch a parallel Haiku agent that takes the PR, issue description, and list of CLAUDE.md files (from step 2), and returns a score to indicate the agent's level of confidence for whether the issue is real or false positive. To do that, the agent should score each issue on a scale from 0-100, indicating its level of confidence. For issues that were flagged due to CLAUDE.md instructions, the agent should double check that the CLAUDE.md actually calls out that issue specifically. The scale is (give this rubric to the agent verbatim):
   a. 0: Not confident at all. This is a false positive that doesn't stand up to light scrutiny, or is a pre-existing issue.
   b. 25: Somewhat confident. This might be a real issue, but may also be a false positive. The agent wasn't able to verify that it's a real issue. If the issue is stylistic, it is one that was not explicitly called out in the relevant CLAUDE.md.
   c. 50: Moderately confident. The agent was able to verify this is a real issue, but it might be a nitpick or not happen very often in practice. Relative to the rest of the PR, it's not very important.
   d. 75: Highly confident. The agent double checked the issue, and verified that it is very likely it is a real issue that will be hit in practice. The existing approach in the PR is insufficient. The issue is very important and will directly impact the code's functionality, or it is an issue that is directly mentioned in the relevant CLAUDE.md. **Leaky abstractions that force consumers into complex boolean logic score at least 75 - every new consumer will likely get it wrong.**
   e. 100: Absolutely certain. The agent double checked the issue, and confirmed that it is definitely a real issue, that will happen frequently in practice. The evidence directly confirms this.
6. Filter out any issues with a score less than 80. If there are no issues that meet this criteria, do not proceed.
7. Use a Haiku agent to repeat the eligibility check from #1, to make sure that the pull request is still eligible for code review.
8. Finally, use the gh bash command to comment back on the pull request with the result. When writing your comment, keep in mind to:
   a. Keep your output brief
   b. Avoid emojis
   c. Link and cite relevant code, files, and URLs

Examples of false positives, for steps 4 and 5:

- Pre-existing issues
- Something that looks like a bug but is not actually a bug
- Pedantic nitpicks that a senior engineer wouldn't call out
- **CRITICAL: Test failures, type errors, build errors, or any issues that would be caught by CI. CI is the gold standard - if tests pass in CI, they pass. Do NOT report issues like "tests are missing parameter X" or "this will fail typecheck" - assume CI catches these. Your job is to find issues CI cannot catch.**
- Issues that a linter, typechecker, or compiler would catch (eg. missing or incorrect imports, type errors, broken tests, formatting issues, pedantic style issues like newlines). No need to run these build steps yourself -- it is safe to assume that they will be run separately as part of CI.
- General code quality issues (eg. lack of test coverage, general security issues, poor documentation), unless explicitly required in CLAUDE.md. **Exception: Leaky abstractions are NOT general quality issues - they are specific design problems that cause bugs. When consumers must combine multiple booleans to answer simple questions ("are we ready?", "what state are we in?"), every new consumer will likely get it wrong.**
- Issues that are called out in CLAUDE.md, but explicitly silenced in the code (eg. due to a lint ignore comment)
- Changes in functionality that are likely intentional or are directly related to the broader change
- Real issues, but on lines that the user did not modify in their pull request
- **Issues where you haven't traced the full data flow - if you only looked at one function in isolation without understanding how data flows into it, your assessment may be wrong**

Notes:

- **MOST IMPORTANT: Do not check build signal or attempt to build or typecheck the app. Do not report test failures, missing test parameters, or type errors. These will run separately in CI, and CI is the gold standard. If something passes CI, it passes. Your job is to find issues CI cannot catch: logic bugs, architectural problems, CLAUDE.md violations, data flow issues, and abstraction design problems.**
- **Trace the complete data flow through the system. Don't just look at individual functions - understand how values flow from entry point to exit point. Many bugs are in the interactions between components, not the components themselves.**
- **Abstraction quality matters as much as correctness.** Code can be "correct" but still poorly designed. If a context/hook/API exposes implementation details that force consumers into complex boolean logic, that's a design issue worth flagging. The question isn't "does it work?" but "will the next developer use it correctly?" Leaky abstractions compound - every consumer that has to understand internal state is a bug waiting to happen.
- Use `gh` to interact with Github (eg. to fetch a pull request, or to create inline comments), rather than web fetch
- Make a todo list first
- You must cite and link each bug (eg. if referring to a CLAUDE.md, you must link it)
- For your final comment, follow the following format precisely (assuming for this example that you found 3 issues):

---

### Code review

Found 3 issues:

1. <brief description of bug> (CLAUDE.md says "<...>")

<link to file and line with full sha1 + line range for context, note that you MUST provide the full sha and not use bash here, eg. https://github.com/anthropics/claude-code/blob/1d54823877c4de72b2316a64032a54afc404e619/README.md#L13-L17>

2. <brief description of bug> (some/other/CLAUDE.md says "<...>")

<link to file and line with full sha1 + line range for context>

3. <brief description of bug> (bug due to <file and code snippet>)

<link to file and line with full sha1 + line range for context>

🤖 Generated with [Claude Code](https://claude.ai/code)

<sub>- If this code review was useful, please react with 👍. Otherwise, react with 👎.</sub>

---

- Or, if you found no issues:

---

### Code review

No issues found. Checked for bugs and CLAUDE.md compliance.

🤖 Generated with [Claude Code](https://claude.ai/code)

- When linking to code, follow the following format precisely, otherwise the Markdown preview won't render correctly: https://github.com/anthropics/claude-cli-internal/blob/c21d3c10bc8e898b7ac1a2d745bdc9bc4e423afe/package.json#L10-L15
  - Requires full git sha
  - You must provide the full sha. Commands like `https://github.com/owner/repo/blob/$(git rev-parse HEAD)/foo/bar` will not work, since your comment will be directly rendered in Markdown.
  - Repo name must match the repo you're code reviewing
  - # sign after the file name
  - Line range format is L[start]-L[end]
  - Provide at least 1 line of context before and after, centered on the line you are commenting about (eg. if you are commenting about lines 5-6, you should link to `L4-7`)
