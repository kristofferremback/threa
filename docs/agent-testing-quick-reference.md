# Agent Testing Quick Reference

> For full details, see [agent-testing-guide.md](./agent-testing-guide.md)

## Quick Start

```bash
# 1. Setup environment
echo "USE_STUB_AUTH=true" >> apps/backend/.env

# 2. Start services
bun run dev

# 3. Navigate to app
# http://localhost:3000/login
```

## Login Flow

```
1. Navigate: http://localhost:3000/login
2. Click: "Sign in with WorkOS"
3. Click: "Alice Anderson" (or fill custom form)
4. Lands on: http://localhost:3000/workspaces
```

## Key URLs

- **Login**: http://localhost:3000/login
- **Stub Auth**: http://localhost:3000/test-auth-login
- **Workspaces**: http://localhost:3000/workspaces
- **Workspace**: http://localhost:3000/w/[workspace-id]
- **Stream**: http://localhost:3000/w/[workspace-id]/streams/[stream-id]

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

## Stub Modes

| Variable                  | Effect               | Use When                       |
| ------------------------- | -------------------- | ------------------------------ |
| `USE_STUB_AUTH=true`      | Simple login page    | **Required** for agent testing |
| `USE_STUB_COMPANION=true` | No AI responses      | Saving API costs               |
| `USE_STUB_AI=true`        | No embeddings/naming | Saving API costs               |

## Preset Users

- Alice Anderson (alice@example.com)
- Bob Builder (bob@example.com)

Or use custom email/name in form.

## Services & Ports

| Service    | Port | URL                   |
| ---------- | ---- | --------------------- |
| Frontend   | 3000 | http://localhost:3000 |
| Backend    | 3001 | http://localhost:3001 |
| PostgreSQL | 5454 | localhost:5454        |
| MinIO      | 9000 | http://localhost:9000 |

## Gotchas

- **Editor is `contenteditable`**, not `<input>` or `<textarea>`
- **Channel creation uses browser `prompt()`**, set up dialog handler first
- **Real-time updates have ~100-500ms delay** (Socket.io)
- **Use unique test IDs** to avoid conflicts: `const testId = Date.now().toString(36)`
- **No passwords in stub auth** - anyone can login as anyone

## Example: Complete User Journey

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

**Login redirect fails**:

- Check `USE_STUB_AUTH=true` in `apps/backend/.env`
- Verify backend running on port 3001

**Database errors**:

```bash
bun run db:reset  # Nuclear option
bun run dev
```

**Session not persisting**:

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

## Testing Workflow

```bash
# 1. Start fresh
bun run db:reset
bun run dev

# 2. Run agent tests
# (navigate, click, type, verify)

# 3. Check logs
# Backend logs appear in terminal
# Frontend logs in browser console
```
