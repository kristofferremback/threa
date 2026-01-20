# Agent Testing Guide for Threa

This guide explains how to run Threa in an agent-friendly mode for browser automation testing using Chrome DevTools MCP skill or similar browser automation tools.

## Overview

Threa supports stub authentication mode that bypasses WorkOS, making it ideal for automated testing. When enabled, a simple login page appears where agents can authenticate with preset users or custom credentials.

## Prerequisites

- Docker (for PostgreSQL and MinIO)
- Bun runtime installed
- Chrome DevTools MCP skill or Playwright for browser automation

## Quick Start

### 1. Environment Setup

Create or verify `apps/backend/.env` file:

```bash
# Database (matches docker-compose.yml)
DATABASE_URL=postgresql://threa:threa@localhost:5454/threa

# Enable stub auth for agent testing
USE_STUB_AUTH=true

# Optional: Stub AI features to avoid API costs during testing
USE_STUB_COMPANION=true
USE_STUB_BOUNDARY_EXTRACTION=true
USE_STUB_AI=true

# Server
PORT=3001

# S3 Storage (uses MinIO locally)
S3_BUCKET=threa-uploads
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_ENDPOINT=http://localhost:9000

# Fast shutdown for development (optional)
FAST_SHUTDOWN=true

# Logging (optional)
LOG_LEVEL=info
```

**Key Configuration:**

- `USE_STUB_AUTH=true` - **Required** for agent testing. Replaces WorkOS with a simple login page.
- `USE_STUB_COMPANION=true` - Optional. Disables AI companion to avoid API costs.
- `USE_STUB_AI=true` - Optional. Stubs naming, embedding, and memo processing.

### 2. Start Services

```bash
# From project root
cd /Users/kristofferremback/dev/personal/threa.tune-claude-md

# Start database and MinIO storage
bun run db:start

# Wait for services to be ready (about 10 seconds)
# PostgreSQL will be on port 5454
# MinIO will be on port 9000

# Start frontend + backend
bun run dev
```

**Expected Output:**

```
Starting PostgreSQL...
Starting MinIO...
Waiting for PostgreSQL to be ready...
PostgreSQL is ready
Waiting for MinIO to be ready...
MinIO is ready
Starting backend and frontend...
```

**Services Will Run On:**

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- PostgreSQL: localhost:5454
- MinIO: http://localhost:9000

### 3. Verify Setup

```bash
# Check backend health
curl http://localhost:3001/health

# Should return: {"status":"ok"}
```

## Authentication Flow for Agents

### URL Structure

1. **Initial Landing**: http://localhost:3000/login
2. **Click "Sign in with WorkOS"**: Redirects to http://localhost:3000/test-auth-login
3. **After Login**: Redirects to http://localhost:3000/workspaces

### Test Login Page

The stub auth login page at `/test-auth-login` provides:

**Preset Users** (click to login instantly):

- Alice Anderson (alice@example.com)
- Bob Builder (bob@example.com)

**Custom Login Form**:

- Email field (default: test@example.com)
- Name field (default: Test User)
- "Sign In" button

### Agent Authentication Steps

```
1. Navigate to: http://localhost:3000/login
2. Wait for heading "Threa" to be visible
3. Click button: "Sign in with WorkOS"
4. Wait for heading "Test Login" to be visible
5. Option A: Click preset button "Alice Anderson"
   OR
   Option B: Fill form:
      - Email: <your-test-email>
      - Name: <your-test-name>
      - Click "Sign In"
6. Redirected to workspace selection page
```

## User Journey After Authentication

### First-Time User (No Workspaces)

After login, users see workspace selection page:

**URL**: http://localhost:3000/workspaces

**Page Elements**:

- Heading: "Welcome, [User Name]"
- Text: "Select a workspace to continue"
- Input: "New workspace name"
- Button: "Create Workspace"

**Creating First Workspace**:

```
1. Fill input "New workspace name" with desired name
2. Click "Create Workspace"
3. Redirected to: http://localhost:3000/w/[workspace-id]
```

### Inside a Workspace

**URL Pattern**: http://localhost:3000/w/[workspace-id]

**Sidebar Structure**:

- Heading "Scratchpads" (level 3)
- Button "+ New Scratchpad"
- Heading "Channels" (level 3)
- Button "+ New Channel"

### Creating a Scratchpad

```
1. Click "+ New Scratchpad"
2. Automatically navigated to new scratchpad
3. URL: http://localhost:3000/w/[workspace-id]/streams/[stream-id]
4. Editor appears with placeholder text
```

### Creating a Channel

```
1. Click "+ New Channel"
2. Browser prompt appears: "Channel name:"
3. Enter channel name (e.g., "general")
4. Channel appears in sidebar as "#general"
5. Click the channel link to navigate to it
```

### Sending Messages

**Message Editor**:

- Rich text editor (contenteditable div, not standard input)
- Located at bottom of stream view
- Placeholder: "Type a message..."

**Sending a Message**:

```
1. Click into the editor (contenteditable element)
2. Type message content
3. Click "Send" button
4. Message appears in timeline above editor
5. Shows author name and timestamp
```

## Common Workflows for Agent Testing

### Complete User Journey

```typescript
// Example Playwright-style workflow
await page.goto("http://localhost:3000/login")
await page.getByRole("button", { name: "Sign in with WorkOS" }).click()
await page.getByRole("button", { name: /Alice Anderson/ }).click()

// Create workspace
await page.getByPlaceholder("New workspace name").fill("Test Workspace")
await page.getByRole("button", { name: "Create Workspace" }).click()

// Create channel
page.once("dialog", async (dialog) => {
  await dialog.accept("general")
})
await page.getByRole("button", { name: "+ New Channel" }).click()

// Wait for channel to appear
await page.getByRole("link", { name: "#general" }).click()

// Send message
await page.locator('[contenteditable="true"]').click()
await page.keyboard.type("Hello from agent test!")
await page.getByRole("button", { name: "Send" }).click()

// Verify message
await page.getByText("Hello from agent test!").waitFor()
```

### Quick Switcher (Cmd+K)

The quick switcher allows fast navigation:

```
1. Press Meta+K (Cmd+K on Mac)
2. Dialog appears with "Stream search" heading
3. Type stream name to search
4. Press Enter to navigate to first result
```

### AI Companion (Scratchpads Only)

When `USE_STUB_COMPANION=false` and AI is configured:

- Scratchpads have AI companion mode
- Toggle between AI on/off (not currently visible in UI by default)
- AI responds to messages automatically

**Note**: For cost-free testing, keep `USE_STUB_COMPANION=true`.

## Testing with Chrome DevTools MCP

### Initial Setup

```typescript
// Navigate to app
await mcp__chrome_devtools__navigate_page({ url: "http://localhost:3000" })

// Take snapshot to see login page
await mcp__chrome_devtools__take_snapshot()

// Click sign in button (using uid from snapshot)
await mcp__chrome_devtools__click({ uid: "button-sign-in" })

// Take another snapshot to see stub auth page
await mcp__chrome_devtools__take_snapshot()

// Click preset user or fill form
await mcp__chrome_devtools__click({ uid: "preset-alice" })
```

### Navigating the App

```typescript
// Create workspace
await mcp__chrome_devtools__fill({
  uid: "input-workspace-name",
  value: "Agent Test Workspace",
})
await mcp__chrome_devtools__click({ uid: "button-create-workspace" })

// Handle channel creation dialog
await mcp__chrome_devtools__handle_dialog({
  action: "accept",
  promptText: "test-channel",
})

// Send message (rich text editor)
await mcp__chrome_devtools__click({ uid: "editor-contenteditable" })
await mcp__chrome_devtools__press_key({ key: "Hello world" })
await mcp__chrome_devtools__click({ uid: "button-send" })
```

## Stub Modes Explained

### USE_STUB_AUTH (Required for Agents)

**What it does**:

- Replaces WorkOS authentication with simple form
- Creates users on-demand (no pre-registration needed)
- Session tokens are simple strings: `test_session_<workos-id>`
- Users persist in database across sessions

**Authentication Mechanism**:

```typescript
// User submits login form
// Backend creates/finds user in database
// Returns session cookie: wos_session=test_session_workos_test_alice_example_com
// Subsequent requests authenticated via cookie
```

### USE_STUB_COMPANION (Optional)

**What it does**:

- Disables AI companion responses in scratchpads
- Saves API costs during testing
- Messages sent to scratchpads receive no AI response

**When to disable** (set to false):

- Testing AI companion features
- Validating AI response formatting
- Integration tests that require actual AI behavior

### USE_STUB_AI (Optional)

**What it does**:

- Stubs stream auto-naming (uses "Untitled" or incremental names)
- Stubs embedding generation (returns dummy vectors)
- Stubs memo classification and extraction
- Prevents all AI API calls for these features

**When to disable**:

- Testing GAM (General Agentic Memory) features
- Validating semantic search
- Integration tests requiring real embeddings

## Database and Storage

### PostgreSQL

**Connection**: postgresql://threa:threa@localhost:5454/threa

**Migrations**: Run automatically on backend startup

**Resetting Database**:

```bash
# Nuclear option: destroys all data
bun run db:reset

# Then restart services
bun run dev
```

### MinIO (S3-Compatible Storage)

**Endpoint**: http://localhost:9000
**Console**: http://localhost:9001
**Credentials**: minioadmin / minioadmin

**Used For**:

- File uploads in messages
- Attachment storage

**Bucket**: `threa-uploads` (created automatically)

## Ports Reference

| Service           | Port | URL                   |
| ----------------- | ---- | --------------------- |
| Frontend (Vite)   | 3000 | http://localhost:3000 |
| Backend (Express) | 3001 | http://localhost:3001 |
| PostgreSQL        | 5454 | localhost:5454        |
| MinIO (API)       | 9000 | http://localhost:9000 |
| MinIO (Console)   | 9001 | http://localhost:9001 |

## Troubleshooting

### "Failed to start services via docker compose"

**Problem**: Docker containers not starting

**Solution**:

```bash
# Check if docker is running
docker ps

# Start containers manually
docker compose up -d postgres minio

# Check container logs
docker compose logs postgres
docker compose logs minio
```

### "Database connection failed"

**Problem**: Backend can't connect to PostgreSQL

**Solution**:

```bash
# Verify postgres is running
docker compose ps postgres

# Check port mapping
docker compose port postgres 5432
# Should show: 0.0.0.0:5454

# Test connection
docker exec threa-postgres-1 psql -U threa -d threa -c "SELECT 1"
```

### "Stuck on login page after clicking sign in"

**Problem**: Not redirecting to stub auth page

**Solution**:

- Verify `USE_STUB_AUTH=true` in `apps/backend/.env`
- Check backend logs for errors
- Ensure backend is running on port 3001
- Verify frontend proxy configuration (vite.config.ts)

### "Session not persisting"

**Problem**: Logged out on page refresh

**Solution**:

- Check browser cookies for `wos_session`
- Verify domain is `localhost` (not 127.0.0.1)
- Check that backend is setting cookies with correct path: `/`

## Known Limitations

### Stub Auth

- **No password protection**: Anyone can login as anyone
- **No email verification**: Email can be any string
- **Session storage is in-memory**: Backend restart logs everyone out
- **Not for production**: Only use in development/testing

### Stub AI

- **No actual intelligence**: Responses are hardcoded or empty
- **No embeddings**: Semantic search won't work
- **No auto-naming**: Streams may have generic names
- **No memos**: GAM features disabled

## Testing Best Practices

### Use Unique Identifiers

```typescript
// Generate unique test IDs to avoid conflicts
const testId = Date.now().toString(36)
const testEmail = `e2e-${testId}@example.com`
const workspaceName = `Test Workspace ${testId}`
```

### Wait for Async Operations

```typescript
// Don't assume instant updates
await page.getByText("Message sent").waitFor({ timeout: 5000 })

// Real-time updates via Socket.io may take 100-500ms
```

### Clean Up After Tests

```typescript
// For isolated tests, use separate database
// Or delete created resources at end of test
// (Note: No API endpoints for deletion yet)
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

## Example Test Scenarios

### Scenario: New User Onboarding

```
1. Navigate to http://localhost:3000
2. Click "Sign in with WorkOS"
3. Fill custom email/name
4. Create workspace
5. Create first scratchpad
6. Send first message
7. Verify message appears
```

### Scenario: Multi-User Collaboration

```
1. Login as Alice
2. Create workspace
3. Create channel
4. Logout
5. Login as Bob
6. Join same workspace (manual dev endpoint needed)
7. Navigate to channel
8. Send message as Bob
9. Verify Alice sees Bob's message (websocket)
```

### Scenario: Rich Text Editing

```
1. Login and navigate to stream
2. Type message with markdown
3. Apply formatting (bold, italic, code)
4. Send message
5. Verify formatting preserved
```

## API Endpoints for Advanced Testing

### Dev-Only Endpoints (Stub Auth Only)

These endpoints are ONLY available when `USE_STUB_AUTH=true`:

**Login as user**:

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

**Join workspace**:

```bash
POST /api/dev/workspaces/:workspaceId/join
Authorization: (authenticated via cookie)

{
  "role": "member" | "admin"
}

# Returns: { member: {...} }
```

**Join stream**:

```bash
POST /api/dev/workspaces/:workspaceId/streams/:streamId/join
Authorization: (authenticated via cookie)

# Returns: { member: {...} }
```

### Standard API Endpoints

**Get workspaces**:

```bash
GET /api/workspaces
Authorization: (authenticated via cookie)

# Returns: { workspaces: [...] }
```

**Create workspace**:

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

**Events**:

- `stream:new-event` - New message/event in stream
- `stream:member-joined` - User joined stream
- `stream:event-updated` - Event edited
- And more (see Socket.io implementation)

**Usage**:

```typescript
// Agent can observe real-time updates
// Useful for multi-user scenarios
const socket = io("http://localhost:3001", {
  withCredentials: true,
})

socket.on("stream:new-event", (data) => {
  console.log("New event:", data)
})
```

## Git Worktrees (Advanced)

For testing multiple branches simultaneously:

```bash
# Create worktree
git worktree add ../threa.feature-test feature/test
cd ../threa.feature-test

# Setup (creates separate database)
bun run setup:worktree

# Start services (uses threa_feature_test database)
bun run dev
```

Each worktree gets its own:

- Database (e.g., `threa_feature_test`)
- .env file (derived from main worktree)
- Independent state

## Summary

**Minimal Agent Testing Setup**:

1. Set `USE_STUB_AUTH=true` in `apps/backend/.env`
2. Run `bun run dev` from project root
3. Navigate agent to http://localhost:3000/login
4. Click preset user or fill form
5. Create workspace, streams, send messages

**Key Gotchas**:

- Rich text editor is `contenteditable`, not `<input>`
- Channel creation uses browser `prompt()` dialog
- Real-time updates may have slight delay (100-500ms)
- Unique test IDs prevent conflicts between runs
- Stub auth has no password—anyone can login as anyone

**Testing Modes**:

- `USE_STUB_AUTH=true` - Simple login (required for agents)
- `USE_STUB_COMPANION=true` - No AI responses (saves costs)
- `USE_STUB_AI=true` - No embeddings/naming (saves costs)

This setup provides a fully functional Threa instance suitable for automated browser testing without requiring external authentication services or AI API keys.
