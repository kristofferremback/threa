<!-- 49287611-88ec-4894-9f13-bac17fdd06de 5e1027e3-52d5-4e79-bae0-a4e8f4e31f73 -->
# Plan: Data Model Overhaul & Fresh Start

We will consolidate the database schema into a single, clean migration that supports the graph model, monetization, and real-time threading from day one. This avoids "migration debt" and ensures a stable foundation.

## 1. Database Schema (Consolidated v2)

Replace existing migrations (`001`..`003`) with a single `001_schema_v2.sql` containing:

- **Workspaces:** Add `stripe_customer_id`, `plan_tier` (free/pro), `seat_limit`, `ai_budget_limit`.
- **Members:** Add `status` (active/invited) for seat counting.
- **Channels:** Add `slug` (unique), `visibility` (public/private), `topic`.
- **Conversations:** The core graph node (`id`, `root_message_id`).
- **Conversation_Channels:** Junction table (`conversation_id`, `channel_id`, `is_primary`).
- **Messages:** Hybrid model (flat `channel_id` vs threaded `conversation_id`).
- **Outbox:** Transactional event log.

## 2. Service Layer Updates

Refactor services to align with the new schema:

- **WorkspaceService:** Handle new monetization fields and seat limit checks.
- **ConversationService:** Ensure "start thread" logic writes to `conversation_channels` and triggers correct outbox events.
- **MessageService:** Support the hybrid flat/threaded reads efficiently.

## 3. Real-Time UX (WebSockets)

Implement the "Slack-like" thread creation flow:

1.  **Scenario:** User A and B both view a flat message.
2.  **Action:** User A replies -> Creates `conversation` + `conversation_created` event.
3.  **Propagation:**

    - Outbox listener picks up `conversation.created`.
    - WebSocket broadcasts to channel.
    - **Client Action:** Clients update the original flat message UI to show it's now a thread root.
    - **Result:** User B sees the thread appear immediately without refreshing.

## 5. Workspace Onboarding & Invites

Add robust flows for creating workspaces and inviting members:

- **Signup Flow:**
    - User authenticates via WorkOS.
    - If no workspace exists for their org, prompt to create one (slug generation).
    - Create Workspace -> Create User -> Add as Admin -> Create #general.
- **Invite Flow:**
    - Admin generates invite link or inputs email.
    - System creates `workspace_members` entry with status `invited`.
    - (Future: Send email via Resend/SendGrid).
    - User clicks link -> Auth -> Status updates to `active`.

## 7. WebSocket Architecture & Outbox Pattern

- **Rooms:**
    - `channel:{id}` - For flat messages & conversation creation events.
    - `thread:{id}` - For threaded replies (users subscribed to a specific thread).
    - `user:{id}` - For notifications/DMs.
- **Outbox Logic (Hybrid NOTIFY + Polling):**
    - **Writer (Transaction):**

        1.  `BEGIN`
        2.  Insert Message/Conversation.
        3.  Insert Outbox Event (`payload` = full event data).
        4.  `NOTIFY 'outbox_event', 'id'` (Lightweight signal).
        5.  `COMMIT`.

    - **Reader (Listener):**
        - **Polling:** Fallback check every 1s (ensures delivery even if NOTIFY missed).
        - **NOTIFY:** On signal, trigger processing.
        - **Debounce Strategy:**
            - Wait **50ms** after first signal to batch burst events.
            - Max wait **200ms** before forcing execution.
        - **Action:** Worker reads pending rows from `outbox` table -> Publish to Redis -> WebSocket Servers -> Clients.

## 9. Detailed Implementation Specs

### A. Schema Definitions (Zod)

- **Workspace:** `{ id, name, slug, plan_tier: 'free'|'pro', seat_limit, created_at }`
- **User:** `{ id, email, name, created_at }`
- **Channel:** `{ id, workspace_id, name, slug, visibility: 'public'|'private', created_at }`
- **Conversation:** `{ id, root_message_id, channel_ids: string[], created_at }`
- **Message:** `{ id, channel_id, conversation_id?, reply_to_message_id?, content, author_id }`

### B. Critical Flows

1.  **Message Creation (Flat):**

    - POST `/api/messages` -> `MessageService.create` -> Insert DB + Outbox -> Notify.
    - WS Server receives Redis event -> Emits `message` to `channel:{id}`.

2.  **Thread Creation (Reply):**

    - POST `/api/messages` (with `reply_to_message_id`).
    - `MessageService`:
        - Check if parent is in conversation. If no, create new `Conversation`.
        - Insert Message linked to Conversation.
        - If new conversation: Emit `conversation.created` (payload: `root_message_id`, `conversation_id`).
        - Emit `message.created` (payload: `conversation_id`, `content`).
    - Clients in `channel:{id}` see `conversation.created` -> Update UI to show "1 reply".

3.  **Multi-Channel Tagging:**

    - User types `#engineering`. `MessageService` detects tag.
    - Add `#engineering` to `conversation_channels`.
    - Emit `conversation.shared` event to both old and new channel rooms.

## 8. Cleanup & Seeds

- Delete old migration files.
- Update `db.ts` or a seed script to populate a default `Free` tier workspace for local dev.

### To-dos

- [ ] Refactor `OutboxListener` to use app-side wake/polling instead of DB triggers