# Agent Testing Guide for Threa

This guide explains how to run Threa in agent-friendly mode for browser automation testing using Chrome DevTools MCP skill or similar tools.

**Target audience**: AI agents performing automated browser testing, not human developers.

## Quick Start

### 1. Start Test Environment

```bash
# From project root
bun run dev:test
```

This single command:

- Creates isolated test database (`threa_test`) if it doesn't exist
- Enables stub authentication (no WorkOS required)
- Starts backend (http://localhost:3001) and frontend (http://localhost:3000)
- Runs migrations automatically

**Services:**

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- PostgreSQL: localhost:5454 (database: `threa_test`)

### 2. Verify Server is Ready

```bash
curl http://localhost:3001/health
# Should return: {"status":"ok"}
```

## Authentication Flow

### Login URL: http://localhost:3000/login

1. Click "Sign in with WorkOS"
2. Redirects to http://localhost:3000/test-auth-login
3. Choose login method:
   - **Preset users** (instant login): Click "Alice Anderson" or "Bob Builder"
   - **Custom user**: Fill email/name form, click "Sign In"
4. Redirects to http://localhost:3000/workspaces

### Preset Users

- Alice Anderson (alice@example.com)
- Bob Builder (bob@example.com)

## User Journey

### First-Time User

**URL**: http://localhost:3000/workspaces

**Actions**:

1. Fill input "New workspace name" with desired name
2. Click "Create Workspace"
3. Redirected to: http://localhost:3000/w/[workspace-id]

### Inside a Workspace

**URL**: http://localhost:3000/w/[workspace-id]

**Sidebar elements**:

- Heading "Scratchpads" (level 3)
- Button "+ New Scratchpad"
- Heading "Channels" (level 3)
- Button "+ New Channel"

### Creating a Scratchpad

1. Click "+ New Scratchpad"
2. Auto-navigates to: http://localhost:3000/w/[workspace-id]/streams/[stream-id]
3. Editor appears with placeholder text

### Creating a Channel

1. Click "+ New Channel"
2. Browser prompt appears: "Channel name:"
3. Enter channel name (e.g., "general")
4. Channel appears in sidebar as "#general"
5. Click channel link to navigate

### Sending Messages

**Message editor** (contenteditable div, not standard input):

1. Click into editor (contenteditable element)
2. Type message content
3. Click "Send" button
4. Message appears in timeline above editor

## Complete User Journey Example

```typescript
// Login
await page.goto("http://localhost:3000/login")
await page.getByRole("button", { name: "Sign in with WorkOS" }).click()
await page.getByRole("button", { name: /Alice Anderson/ }).click()

// Create workspace
await page.getByPlaceholder("New workspace name").fill("Test Workspace")
await page.getByRole("button", { name: "Create Workspace" }).click()

// Create channel (handle dialog)
page.once("dialog", async (dialog) => {
  await dialog.accept("general")
})
await page.getByRole("button", { name: "+ New Channel" }).click()

// Wait for channel to appear and click it
await page.getByRole("link", { name: "#general" }).click()

// Send message
await page.locator('[contenteditable="true"]').click()
await page.keyboard.type("Hello from agent test!")
await page.getByRole("button", { name: "Send" }).click()

// Verify message
await page.getByText("Hello from agent test!").waitFor()
```

## Key Gotchas

1. **Message editor is `contenteditable`**, not `<input>` or `<textarea>`
2. **Channel creation uses browser `prompt()`** - set up dialog handler before clicking
3. **Real-time updates have ~100-500ms delay** (Socket.io)
4. **Use unique test IDs** to avoid conflicts: `const testId = Date.now().toString(36)`

## Database Management

The test database (`threa_test`) is isolated from the main development database and **persists between test runs by design**. Migrations handle schema updates automatically, so you typically don't need to recreate it.

**Only if you need to start completely fresh** (rare - usually only for debugging corrupted state):

```bash
# Stop server (Ctrl+C)

# Drop and recreate test database
docker exec threa-postgres-1 psql -U threa -d postgres -c "DROP DATABASE IF EXISTS threa_test"

# Restart test server (will create fresh database)
bun run dev:test
```

## API Endpoints for Testing

### Dev-Only Endpoints (Stub Auth Only)

**Login programmatically:**

```bash
POST /api/dev/login
Content-Type: application/json

{
  "email": "test@example.com",
  "name": "Test User"
}

# Returns: { user: { id, email, name } }
# Sets cookie: wos_session
```

**Join workspace:**

```bash
POST /api/dev/workspaces/:workspaceId/join
Authorization: (authenticated via cookie)

{
  "role": "member" | "admin"
}
```

**Join stream:**

```bash
POST /api/dev/workspaces/:workspaceId/streams/:streamId/join
Authorization: (authenticated via cookie)
```

### Standard API Endpoints

**Get workspaces:**

```bash
GET /api/workspaces
Authorization: (authenticated via cookie)

# Returns: { workspaces: [...] }
```

**Create workspace:**

```bash
POST /api/workspaces
Content-Type: application/json

{
  "name": "My Workspace"
}

# Returns: { workspace: {...} }
```

**Bootstrap workspace** (gets all initial data):

```bash
GET /api/workspaces/:workspaceId/bootstrap
Authorization: (authenticated via cookie)

# Returns: {
#   workspace, members, streams, personas,
#   streamMemberships, users, unreadCounts,
#   commandDescriptors
# }
```

## WebSocket (Real-Time Events)

**Connection**: http://localhost:3001/socket.io

**Authentication**: Via cookie (`wos_session`)

**Key Events**:

- `stream:new-event` - New message/event in stream
- `stream:member-joined` - User joined stream
- `stream:event-updated` - Event edited

## Troubleshooting

### "Failed to start services via docker compose"

```bash
# Check if docker is running
docker ps

# Start database manually
docker compose up -d postgres minio
```

### "Database connection failed"

```bash
# Verify postgres is running
docker compose ps postgres

# Check port mapping (should show 0.0.0.0:5454)
docker compose port postgres 5432

# Test connection
docker exec threa-postgres-1 psql -U threa -d threa_test -c "SELECT 1"
```

### "Stuck on login page after clicking sign in"

- Check backend logs for errors
- Verify backend is running on port 3001: `curl http://localhost:3001/health`
- Ensure USE_STUB_AUTH is enabled (should be automatic with `bun run dev:test`)

### "Session not persisting"

- Use `localhost`, not `127.0.0.1`
- Check browser cookies for `wos_session`
- Verify cookie domain is `localhost` with path `/`

## Testing Best Practices

### Use Unique Test IDs

```typescript
const testId = Date.now().toString(36)
const testEmail = `e2e-${testId}@example.com`
const workspaceName = `Test Workspace ${testId}`
```

### Wait for Async Operations

```typescript
// Real-time updates via Socket.io may take 100-500ms
await page.getByText("Message sent").waitFor({ timeout: 5000 })
```

### Handle Dialogs Properly

```typescript
// Set up handler BEFORE triggering action
page.once("dialog", async (dialog) => {
  await dialog.accept("channel-name")
})

// THEN trigger the action
await page.click('button[name="New Channel"]')
```

## Ports Reference

| Service           | Port | URL                   |
| ----------------- | ---- | --------------------- |
| Frontend (Vite)   | 3000 | http://localhost:3000 |
| Backend (Express) | 3001 | http://localhost:3001 |
| PostgreSQL        | 5454 | localhost:5454        |
| MinIO (API)       | 9000 | http://localhost:9000 |
| MinIO (Console)   | 9001 | http://localhost:9001 |

## What Stub Auth Does

**Stub authentication** replaces WorkOS with a simple login page:

- Creates users on-demand (no pre-registration needed)
- Session tokens are simple strings: `test_session_<workos-id>`
- Users persist in database across sessions
- No password protection (anyone can login as anyone)
- **Only for development/testing** - never use in production

## Summary

**Minimal setup for agent testing:**

1. Run `bun run dev:test` from project root
2. Navigate to http://localhost:3000/login
3. Click preset user or fill form
4. Create workspace, streams, send messages

**Key differences from production:**

- Stub auth (no WorkOS)
- Isolated test database (`threa_test`)
- All AI features work (not stubbed)
- No password protection
