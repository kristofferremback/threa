# Agent Testing Quick Reference

> For full details, see [agent-testing-guide.md](./agent-testing-guide.md)

**Target audience**: AI agents performing automated browser testing

## Quick Start

```bash
# Single command - sets up everything
bun run dev:test
```

This command:

- Creates isolated test database (`threa_test`)
- Enables stub auth automatically
- Starts backend + frontend
- Runs migrations

## Access

- **Frontend**: http://localhost:3000
- **Backend**: http://localhost:3001
- **Database**: `threa_test` (isolated from development)

## Login Flow

```
1. Navigate: http://localhost:3000/login
2. Click: "Sign in with WorkOS"
3. Click: "Alice Anderson" (or fill custom form)
4. Lands on: http://localhost:3000/workspaces
```

## Preset Users

- Alice Anderson (alice@example.com)
- Bob Builder (bob@example.com)

## Common Actions

### Create Workspace

```
1. Fill input: "New workspace name"
2. Click: "Create Workspace"
```

### Create Channel

```
1. Click: "+ New Channel"
2. Handle browser prompt (dialog.accept("channel-name"))
```

### Create Scratchpad

```
1. Click: "+ New Scratchpad"
2. Auto-navigates to new scratchpad
```

### Send Message

```
1. Click: contenteditable editor (not <input>!)
2. Type: message text
3. Click: "Send"
```

## Key Gotchas

1. **Editor is `contenteditable`**, not `<input>` or `<textarea>`
2. **Channel creation uses browser `prompt()`** - set up dialog handler first
3. **Real-time updates have ~100-500ms delay** (Socket.io)
4. **Use unique test IDs**: `const testId = Date.now().toString(36)`

## Database Management

Test database persists between runs (this is normal). Rarely needed, but to reset completely:

```bash
# Stop server (Ctrl+C)
docker exec threa-postgres-1 psql -U threa -d postgres -c "DROP DATABASE IF EXISTS threa_test"
bun run dev:test
```

## Complete Example

```typescript
// Login
await page.goto("http://localhost:3000/login")
await page.click('button:has-text("Sign in with WorkOS")')
await page.click('button:has-text("Alice Anderson")')

// Create workspace
await page.fill('input[placeholder="New workspace name"]', "Test Workspace")
await page.click('button:has-text("Create Workspace")')

// Create channel (handle dialog)
page.once("dialog", (dialog) => dialog.accept("general"))
await page.click('button:has-text("+ New Channel")')

// Send message
await page.click('[contenteditable="true"]')
await page.keyboard.type("Hello world")
await page.click('button:has-text("Send")')
await page.waitForSelector("text=Hello world")
```

## Troubleshooting

**Login redirect fails:**

- Verify backend running: `curl http://localhost:3001/health`
- Check USE_STUB_AUTH is enabled (automatic with `bun run dev:test`)

**Database errors (corrupted state):**

If you suspect corrupted data and need to start completely fresh:

```bash
docker exec threa-postgres-1 psql -U threa -d postgres -c "DROP DATABASE IF EXISTS threa_test"
bun run dev:test
```

**Session not persisting:**

- Use `localhost`, not `127.0.0.1`
- Check `wos_session` cookie exists

## Dev Endpoints (Stub Auth Only)

```bash
# Login programmatically
POST /api/dev/login
{ "email": "test@example.com", "name": "Test User" }

# Join workspace
POST /api/dev/workspaces/:workspaceId/join
{ "role": "member" }

# Join stream
POST /api/dev/workspaces/:workspaceId/streams/:streamId/join
```

## What `bun run dev:test` Does

1. Creates `threa_test` database if it doesn't exist
2. Sets `USE_STUB_AUTH=true` (automatic, no .env editing needed)
3. Sets `DATABASE_URL` to use test database
4. Starts frontend and backend
5. Runs migrations on startup
