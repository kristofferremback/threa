---
name: schedule
description: Schedule a delayed action. Use when the user asks to run something "in X minutes", "after Y minutes", or wants to wait before doing something.
---

# Schedule

Schedule an action to run after a delay. Supports both focused (blocking) and background (non-blocking) modes.

## Usage

```
/schedule <duration> <action>
```

Examples:
- `/schedule 10m /code-review`
- `/schedule 5m run tests`
- `/schedule 30s check build status`
- `/schedule 1h /code-review`

## Step 1: Parse Arguments

Extract from the user's request:
- **duration**: time to wait (supports `Xs`/`Xm`/`Xh` — e.g. `30s`, `10m`, `1h`)
- **action**: what to do after the delay (a skill like `/code-review`, or a freeform instruction)

Convert duration to seconds:
- `Xs` or bare number → X seconds
- `Xm` → X × 60 seconds
- `Xh` → X × 3600 seconds

## Step 2: Choose Mode

**Background mode** (default — allows user to keep working):

1. Launch a background Bash command:
   ```
   Bash(command: "sleep <seconds> && echo 'TIMER_COMPLETE'", run_in_background: true)
   ```
2. Tell the user: "Timer set for <duration>. You can keep working — I'll run <action> when it fires."
3. Wait for the background task with `TaskOutput(task_id, block: true, timeout: 600000)`.
   - If the wait is longer than 10 minutes (600000ms), chain multiple `TaskOutput` calls — each with `timeout: 600000`.
4. When the timer completes, execute the scheduled action.

**Focused mode** (use when user explicitly says "wait" or the delay is ≤ 60 seconds):

1. Run directly:
   ```
   Bash(command: "sleep <seconds> && echo 'ready'", timeout: <seconds * 1000 + 60000>)
   ```
   Note: Bash timeout max is 600000ms (10 min), so focused mode only works for delays ≤ ~9 minutes.
2. When the sleep returns, execute the scheduled action.

## Step 3: Execute the Action

When the timer fires:
- If the action is a skill (starts with `/`), invoke it with the Skill tool.
- If the action is a freeform instruction, execute it directly.

## Constraints

- `Bash` timeout cap: 600000ms (10 min). Use background mode for anything longer.
- `TaskOutput` timeout cap: 600000ms. Chain calls for waits > 10 min.
- Maximum practical delay: ~2 hours (longer delays risk session/connection issues).
- If the user interrupts or sends a new message during a focused wait, the sleep is cancelled. Background mode is more resilient.

## Example Flow

User: "Run a code review in 10 minutes"

1. Parse: duration = 10m = 600s, action = `/code-review`
2. Background mode (> 60s):
   ```
   Bash("sleep 600 && echo 'TIMER_COMPLETE'", run_in_background: true)
   ```
3. Reply: "Timer set for 10 minutes. I'll run /code-review when it fires. You can keep working."
4. `TaskOutput(task_id, block: true, timeout: 600000)`
5. On completion → invoke Skill(skill: "code-review")
