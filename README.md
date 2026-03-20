# Threa

**AI-powered knowledge chat — where conversations build lasting knowledge.**

## The Problem

Critical information shared in team chat disappears into an endless scroll. Decisions, context, and tribal knowledge get buried and forgotten. Teams repeat discussions, lose context, and watch institutional memory decay.

## What Threa Does

Threa is a chat application with an AI memory layer called **GAM (General Agentic Memory)**. As conversations happen, GAM automatically classifies messages and extracts important knowledge into structured **memos** — summaries linked back to the original messages. These memos are searchable via both full-text and semantic (vector) search, turning everyday chat into a durable knowledge base.

### Solo-First Design

Unlike traditional team chat that starts with channels, Threa starts with **scratchpads** — personal, AI-assisted notes. Users get AI-powered personal knowledge management first, which naturally expands into team collaboration through channels and direct messages.

### Core Features

- **Scratchpads** — personal notes with an AI companion
- **Channels** — public or private team conversations
- **Direct messages** — one-on-one chat
- **Threads** — nested discussions off any message
- **AI companion** — a per-conversation assistant powered by customizable personas
- **Memos** — automatically extracted knowledge from conversations (GAM)
- **Search** — combined full-text and semantic search with filters

## Architecture

Threa is a monorepo with four services:

```
Browser ──→ Cloudflare Pages (Frontend)
         ──→ Cloudflare Worker (Workspace Router) ──→ Control Plane
                                                  ──→ Regional Backend
         ──→ WebSocket (direct to Regional Backend)
```

**Frontend** — React SPA served from Cloudflare Pages. Real-time updates via Socket.io.

**Workspace Router** — Cloudflare Worker at the edge. Routes API requests to either the control plane (auth, workspace creation) or the correct regional backend, using Cloudflare KV to resolve workspace-to-region mappings.

**Control Plane** — Global service handling authentication (via WorkOS), workspace creation, and region assignment. Runs on Railway with its own PostgreSQL database.

**Backend** — Regional application server running all domain logic: messaging, streams, AI agents, memos, search, and file handling. Backed by PostgreSQL 17 with pgvector, AWS S3 for files, and OpenRouter as the AI model gateway. Uses event sourcing with an outbox pattern for reliable real-time delivery.

The architecture is multi-region by design — each region gets its own backend, database, and storage — though currently a single region is active.
