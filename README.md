# Threa - Minimal Chat Application

A minimal real-time chat application built with:

- **Bun** - Fast JavaScript runtime
- **Hono** - Lightweight web framework
- **Bun native WebSockets** - Real-time messaging
- **WorkOS + Authkit** - Authentication and authorization

## Features

✅ Login and logout with WorkOS Authkit
✅ Refresh token support (15 min access tokens, 7 day refresh tokens)
✅ Authenticated WebSocket connections
✅ Real-time messaging between users
✅ Minimal frontend with chat interface

## Prerequisites

- [Bun](https://bun.sh) installed (v1.0+)
- [WorkOS account](https://workos.com) with Authkit configured

## Setup

### 1. Install Dependencies

```bash
bun install
```

### 2. Configure WorkOS

1. Create a WorkOS account at [workos.com](https://workos.com)
2. Create a new application
3. Enable Authkit authentication
4. Get your API key and Client ID from the WorkOS dashboard

### 3. Environment Variables

Copy the example environment file and fill in your WorkOS credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# WorkOS Configuration
WORKOS_API_KEY=sk_test_your_api_key_here
WORKOS_CLIENT_ID=client_your_client_id_here
WORKOS_REDIRECT_URI=http://localhost:3000/api/auth/callback

# Application
PORT=3000
NODE_ENV=development
JWT_SECRET=your-secret-key-change-in-production
```

**Important:** Change `JWT_SECRET` to a secure random string in production!

### 4. Configure WorkOS Redirect URI

In your WorkOS dashboard, add the redirect URI:

```
http://localhost:3000/api/auth/callback
```

For production, use your actual domain:

```
https://yourdomain.com/api/auth/callback
```

## Running the Application

### Development Mode (with hot reload)

```bash
bun run dev
```

### Production Mode

```bash
bun run start
```

The application will be available at [http://localhost:3000](http://localhost:3000)

## How It Works

### Authentication Flow

1. User clicks "Login with WorkOS"
2. Redirected to WorkOS Authkit login page
3. After successful login, WorkOS redirects back to `/api/auth/callback`
4. Server exchanges auth code for user information
5. Server creates access token (15 min) and refresh token (7 days)
6. Tokens stored in localStorage
7. User redirected to chat interface

### WebSocket Authentication

1. Client connects to `/ws` endpoint with access token as query parameter
2. Server verifies token before upgrading to WebSocket
3. WebSocket connection tied to authenticated user
4. Messages broadcast to all connected clients

### Token Refresh

- Access tokens expire after 15 minutes
- Refresh tokens expire after 7 days
- Frontend automatically refreshes access token every 10 minutes
- If refresh fails, user is logged out

## API Endpoints

| Method | Path                 | Description                        |
| ------ | -------------------- | ---------------------------------- |
| GET    | `/`                  | Serves frontend HTML               |
| GET    | `/api/auth/login`    | Redirects to WorkOS login          |
| GET    | `/api/auth/callback` | Handles WorkOS callback            |
| POST   | `/api/auth/refresh`  | Refreshes access token             |
| POST   | `/api/auth/logout`   | Logs out user                      |
| GET    | `/api/auth/me`       | Gets current user info             |
| GET    | `/ws`                | WebSocket endpoint (authenticated) |

## Project Structure

```
threa/
├── src/
│   ├── server.ts       # Main server with Hono + WebSocket
│   └── index.html      # Minimal frontend
├── docs/
│   └── spec.md         # Full product specification
├── .env.example        # Environment variables template
├── package.json        # Dependencies and scripts
└── README.md          # This file
```

## Security Notes

- **JWT Secret:** Use a strong random secret in production
- **HTTPS:** Always use HTTPS in production for secure WebSocket connections
- **Token Storage:** Tokens stored in localStorage (consider httpOnly cookies for production)
- **XSS Protection:** HTML is escaped in chat messages
- **Token Expiration:** Short-lived access tokens with refresh mechanism

## Next Steps

This is a minimal proof of concept. For production, consider:

- [ ] Use Redis for session storage instead of in-memory Map
- [ ] Use httpOnly cookies for token storage
- [ ] Add rate limiting
- [ ] Add message persistence (database)
- [ ] Add proper error handling and logging
- [ ] Add tests
- [ ] Set up CI/CD
- [ ] Add proper production deployment configuration

## Development Notes

- Bun automatically loads `.env` file (no need for dotenv package)
- Bun native WebSocket support (no need for `ws` package)
- Hot reload enabled in development mode with `--hot` flag

## License

MIT

## Full Specification

See [docs/spec.md](./docs/spec.md) for the complete product specification and roadmap.
