# Threa - Minimal Chat Application

A minimal real-time chat application built with:

- **Bun** - Fast JavaScript runtime
- **Express** - Web framework
- **Socket.IO** - Real-time messaging with Redis adapter
- **React + Vite** - Frontend framework
- **WorkOS + Authkit** - Authentication and authorization
- **Redis** - WebSocket pub/sub and message broadcasting
- **Pino** - Structured logging

## Features

✅ Login and logout with WorkOS Authkit  
✅ Authenticated WebSocket connections via Socket.IO  
✅ Real-time messaging between users  
✅ Message persistence with PostgreSQL  
✅ PostgreSQL NOTIFY for outbox pattern  
✅ Redis adapter for horizontal scaling  
✅ Structured logging with Pino  
✅ Modern React frontend with Tailwind CSS

## Prerequisites

- [Bun](https://bun.sh) installed (v1.0+)
- [Docker](https://www.docker.com) (for PostgreSQL and Redis)
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
4. Get your API key, Client ID, and Cookie Password from the WorkOS dashboard

### 3. Environment Variables

Create a `.env` file in the root directory:

```env
# WorkOS Configuration
WORKOS_API_KEY=sk_test_your_api_key_here
WORKOS_CLIENT_ID=client_your_client_id_here
WORKOS_REDIRECT_URI=http://localhost:3000/api/auth/callback
WORKOS_COOKIE_PASSWORD=your_cookie_password_here

# Application
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# Database
DATABASE_URL=postgresql://threa:threa@localhost:5433/threa

# Redis (optional - defaults to localhost:6380)
REDIS_URL=redis://localhost:6380
```

**Important:**

- Get `WORKOS_COOKIE_PASSWORD` from your WorkOS dashboard (it's a 32-character string)
- Change all secrets in production!

### 4. Configure WorkOS Redirect URI

In your WorkOS dashboard, add the redirect URI:

```
http://localhost:3000/api/auth/callback
```

For production, use your actual domain:

```
https://yourdomain.com/api/auth/callback
```

### 5. Start PostgreSQL and Redis

PostgreSQL and Redis are required. Start them with Docker Compose:

```bash
bun run dev:redis
```

Or manually:

```bash
docker compose up -d
```

This starts:

- PostgreSQL on port 5433 (host) → 5432 (container)
- Redis on port 6380 (host) → 6379 (container)

To stop:

```bash
bun run stop:redis
```

## Running the Application

### Development Mode

This starts Redis, the backend server, and the frontend dev server concurrently:

```bash
bun run dev
```

This runs:

- Redis (via Docker Compose)
- Backend server (`src/server/index.ts`) with hot reload
- Frontend dev server (Vite) with HMR

The application will be available at:

- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend API: [http://localhost:3000/api](http://localhost:3000/api)

### Production Mode

Build and start:

```bash
bun run build
bun run start
```

## How It Works

### Authentication Flow

1. User clicks "Login with WorkOS"
2. Redirected to WorkOS Authkit login page
3. After successful login, WorkOS redirects back to `/api/auth/callback`
4. Server exchanges auth code for user information
5. Server creates sealed session cookie (`wos_session`)
6. User redirected to chat interface

### WebSocket Authentication

1. Client connects to Socket.IO server
2. Socket.IO middleware extracts `wos_session` cookie from handshake
3. Server verifies session with WorkOS before accepting connection
4. WebSocket connection tied to authenticated user
5. Messages broadcast to all connected clients via Redis adapter

### Real-Time Messaging

- Socket.IO handles WebSocket connections
- Redis adapter enables message broadcasting across multiple server instances
- Messages appear instantly across all connected clients
- Connection status and typing indicators supported

## API Endpoints

| Method    | Path                 | Description                        |
| --------- | -------------------- | ---------------------------------- |
| GET       | `/`                  | Serves frontend HTML (production)  |
| GET       | `/health`            | Health check endpoint              |
| GET       | `/api/auth/login`    | Redirects to WorkOS login          |
| GET       | `/api/auth/callback` | Handles WorkOS callback            |
| POST      | `/api/auth/logout`   | Logs out user                      |
| GET       | `/api/auth/me`       | Gets current user info             |
| WebSocket | `/` (Socket.IO)      | WebSocket endpoint (authenticated) |

## Project Structure

```
threa/
├── src/
│   ├── server/
│   │   ├── index.ts              # Express server setup
│   │   ├── config.ts             # Configuration
│   │   ├── routes/
│   │   │   └── auth.ts           # Authentication routes
│   │   ├── websockets/
│   │   │   └── index.ts          # Socket.IO server setup
│   │   └── lib/
│   │       ├── logger.ts         # Pino logger
│   │       ├── cookie-utils.ts   # Cookie parsing utilities
│   │       ├── storage.ts        # Storage utilities
│   │       └── types.ts          # Shared types
│   └── frontend/
│       ├── index.html            # HTML entry point
│       ├── App.tsx               # Main React component
│       ├── index.css             # Tailwind CSS styles
│       └── auth/                 # Authentication context & hooks
├── docs/
│   └── spec.md                   # Full product specification
├── docker-compose.yml            # Redis service
├── package.json                  # Dependencies and scripts
├── tsconfig.json                 # TypeScript config
├── tsconfig.server.json          # Server TypeScript config
├── vite.config.ts                # Vite config
├── tailwind.config.js            # Tailwind config
└── README.md                     # This file
```

## Technology Stack

### Backend

- **Express** - HTTP server framework
- **Socket.IO** - WebSocket library with Redis adapter
- **WorkOS** - Authentication provider
- **Redis** - Pub/sub for Socket.IO message broadcasting
- **Pino** - Structured logging
- **TypeScript** - Type safety

### Frontend

- **React 19** - UI framework
- **Vite** - Build tool and dev server
- **Tailwind CSS** - Styling
- **Socket.IO Client** - WebSocket client
- **Lucide React** - Icons
- **Sonner** - Toast notifications
- **date-fns** - Date formatting

### Infrastructure

- **Docker Compose** - Local Redis instance
- **Bun** - Runtime and package manager

## Development Notes

- Bun automatically loads `.env` file (no need for dotenv package)
- Socket.IO uses Redis adapter for horizontal scaling
- Hot reload enabled in development mode
- Structured logging with Pino (pretty-printed in development)
- WorkOS sealed sessions stored in httpOnly cookies

## Security Notes

- **Sealed Sessions:** WorkOS sealed sessions are cryptographically signed cookies
- **HTTPS:** Always use HTTPS in production for secure WebSocket connections
- **Cookie Security:** Cookies are httpOnly, secure in production, and sameSite=lax
- **Redis:** Ensure Redis is not exposed publicly in production

## Next Steps

This is a minimal proof of concept. For production, consider:

- [ ] Add message persistence (database)
- [ ] Add rate limiting
- [ ] Add proper error handling and monitoring
- [ ] Add tests
- [ ] Set up CI/CD
- [ ] Add proper production deployment configuration
- [ ] Implement multi-channel conversations (see spec.md)
- [ ] Add AI-powered question answering (see spec.md)

## License

MIT

## Full Specification

See [docs/spec.md](./docs/spec.md) for the complete product specification and roadmap.
