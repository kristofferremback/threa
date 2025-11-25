IDs use a resource prefix + ulid.

- workspace: `ws_`
- user: `usr_`
- message: `msg_`
- message*revision: `msg*:<rev>`
- message*reaction: `msgr*`
- channel: `chan_`
- conversation: `conv_`

websocket plan:

- rooms are per-channel for simplicity's sake.
- frontend is responsible for displaying messages in the correct place, such as a nested conversation

Rooms:

- `ws.{workspaceId}` - **Global Workspace Room**.
  - **Active:** Always, while app is open.
  - **Content:** Lightweight notifications ("New message in #general"), unread count updates, user presence changes ("User X came online"), typing indicators.
  - **No** full message content.
- `ws.{workspaceId}.chan.{channelId}` - **Active Channel Room**.
  - **Active:** Only when user is viewing this specific channel.
  - **Content:** Full message payloads, edits, deletions, reactions _for this channel_.
- `ws.{workspaceId}.conv.{conversationId}` - **Active Thread Room**.
  - **Active:** Only when user has this specific thread open in the sidebar.
  - **Content:** Full reply payloads for this thread.
- `user.{userId}` - **Private User Room**.
  - **Active:** Always.
  - **Content:** System alerts ("You were kicked"), force logout, critical errors.

From Gemini:

```
Room Name	Scope	Content	Active When...
ws:123	Global	Notifications, Counts, Presence	App is open
chan:456	Main View	Full Root Messages	Channel 456 is focused
conv:789	Thread View	Full Reply Messages	Thread 789 is open in sidebar
user:abc	Private	"You were kicked", "Force logout"	App is open
```

A message may be sent to several rooms as it may be part of multiple conversations in multiple channels. This can be optimized later on.

Messages are saved in a message stream global to the workspace in postgresql with attributes that lets us know which channel(s) and conversation(s) it belongs to.

When sending a message, an ack separate from the published message should be expected, which either reports an error or a success:

- client sends message to server
- server receives message, tries saves it in the database, sends message to client with a receipt or reject
- server publishes message

```yaml
workspace:
  workspace_id: ws_1234567890
  name: My Workspace
  slug: my-workspace # Globally unique
  workos_organization_id: org_1234567890 # WorkOS organization ID
  stripe_customer_id: cus_1234567890 # Stripe customer ID
  plan_tier: free | pro | enterprise # Plan tier
  included_seats: 10 # Included seats for the workspace, further users need to be purchased
  created_at: 2025-01-01T00:00:00Z
  updated_at: 2025-01-01T00:00:00Z
  deleted_at?: 2025-01-01T00:00:00Z

# TODO: billing

workspace_member:
  workspace_id: ws_1234567890
  user_id: usr_1234567890
  role: owner | admin | member | guest # Role in the workspace
  status: invited | active| suspended # Status of the user in the workspace
  invited_at?: 2025-01-01T00:00:00Z
  joined_at?: 2025-01-01T00:00:00Z
  removed_at?: 2025-01-01T00:00:00Z

user:
  user_id: usr_1234567890
  email: john.doe@example.com
  name: John Doe
  workos_user_id: ext_1234567890 # WorkOS user ID
  timezone: Europe/Stockholm
  locale: en-US # ...loads different ones of them
  created_at: 2025-01-01T00:00:00Z
  updated_at: 2025-01-01T00:00:00Z
  deleted_at?: 2025-01-01T00:00:00Z
  archived_at?: 2025-01-01T00:00:00Z

# This one could either be flattened o r use JSONB for the settings.
# For now we'll use JSONB.
user_workspace_settings:
  user_id: usr_1234567890
  workspace_id: ws_1234567890
  settings:
    pinned_channels: [chan_1234567890, chan_1234567891]
    pinned_conversations: [conv_1234567890, conv_1234567891]
    pinned_users: [usr_1234567890, usr_1234567891]
    theme: light | dark | system
  created_at: 2025-01-01T00:00:00Z
  updated_at: 2025-01-01T00:00:00Z
  deleted_at?: 2025-01-01T00:00:00Z

message:
  message_id: msg_12451231
  message_revision_id: msg_12451231:1 # message_id:revision_number
  message_client_gen_id: msgclnt_151231
  workspace_id: ws_1234567890
  content: "Hello, **Name**" # markdown with :emoji:s
  user_id: user_1234567890
  context: channel # channel | conversation; explicit tag for which context the message lives in, e.g., should it be displayed in the channel or the conversation?
  channel_ids: [chan_1234567890, chan_1234567891] # must contain at least one
  conversation_ids: [conv_1234567890, conv_1234567891] # may be empty
  created_at: 2025-01-01T00:00:00Z
  updated_at: 2025-01-01T00:00:00Z
  deleted_at?: 2025-01-01T00:00:00Z

message_revisions:
  message_revision_id: msg_24125131:1 # message_id:revision_number
  message_id: msg_24125131
  content: "Hello, **Name**" # markdown with :emoji:s
  created_at: 2025-01-01T00:00:00Z
  updated_at: 2025-01-01T00:00:00Z
  deleted_at?: 2025-01-01T00:00:00Z

message_reactions:
  message_reaction_id: msgr_15123124
  user_id: usr_1234567890
  message_id: msg_24125131
  reaction: "+1"
  created_at: 2025-01-01T00:00:00Z
  updated_at: 2025-01-01T00:00:00Z
  deleted_at?: 2025-01-01T00:00:00Z

channel:
  channel_id: chan_1234567890
  workspace_id: ws_1234567890
  slug: general # Unique within namespace
  type: public | private | direct
  topic: Topic of the channel # markdown
  created_at: 2025-01-01T00:00:00Z
  updated_at: 2025-01-01T00:00:00Z
  archived_at?: 2025-01-01T00:00:00Z

channel_members:
  channel_id: chan_1234567890
  user_id: usr_1234567890
  added_by_user_id?: usr_1234567890
  added_at: 2025-01-01T00:00:00Z
  removed_at?: 2025-01-01T00:00:00Z
  updated_at: 2025-01-01T00:00:00Z
  notify_level: default | all | mentions | muted # Added 'all' and 'muted'
  last_read_message_id?: msg_1234567890
  last_read_at?: 2025-01-01T00:00:00Z

conversation:
  conversation_id: conv_1234567890
  workspace_id: ws_1234567890
  root_message_id: msg_1234567890
  channel_ids: [chan_1234567890, chan_1234567891] # must contain at least one
  created_at: 2025-01-01T00:00:00Z
  updated_at: 2025-01-01T00:00:00Z
  deleted_at?: 2025-01-01T00:00:00Z

conversation_members:
  conversation_id: conv_1234567890
  user_id: usr_1234567890
  added_by_user_id?: usr_1234567890
  added_at: 2025-01-01T00:00:00Z
  removed_at?: 2025-01-01T00:00:00Z
  updated_at: 2025-01-01T00:00:00Z
  notify_level: default | all | mentions | muted
  last_read_message_id?: msg_1234567890
  last_read_at?: 2025-01-01T00:00:00Z
```

Notes on workspaces:

- To create a workspace, a user signs up and will be shown a page where it says "You are not a member of any workspaces yet, create a new workspace or ask your admin to add you to your workspace."
- When creating a free workspace, the slug should be auto generated. To be able to pick a slug, a pro plan is required.
- The user that creates a workspace becomes the owner

Endpoints:

```md
GET /api/auth/login
GET /api/auth/logout
GET /api/auth/me
GET /api/auth/workos/callback # workos callback

GET /api/workspaces # list all workspaces the user is a member of

GET /api/workspaces/{workspaceId}/bootstrap # bootstrap the chosen workspace for the client

# - lists all channels the user is a member of, including last read messages & UNREAD COUNTS

# - get a list of conversations the user is a member of, with UNREAD COUNTS

# - get a list of users in the workspace (for auto-complete)

# - get the user's workspace settings

# - get the user's pinned channels

# - default channel to open if the client doesn't have a last opened channel

GET /api/workspaces/{workspaceId}/channels # list all channels in the workspace the user can see (e.g., exclude hidden channels they are not a member of)
GET /api/workspaces/{workspaceId}/channels/{channelId} # get a channel

GET /api/workspaces/{workspaceId}/conversations # list the most recent conversations the user is a member of
GET /api/workspaces/{workspaceId}/conversations/{conversationId} # get a conversation, including messages, members, etc

GET /api/workspaces/{workspaceId}/users # list all users in the workspace
GET /api/workspaces/{workspaceId}/users/{userId} # get a user

GET /api/workspaces/{workspaceId}/settings # get the workspace settings
GET /api/workspaces/{workspaceId}/settings/pinned_channels # get the user's pinned channels
GET /api/workspaces/{workspaceId}/settings/pinned_conversations # get the user's pinned conversations
POST /api/workspaces/{workspaceId}/settings/pinned_channels # pin a channel
POST /api/workspaces/{workspaceId}/settings/pinned_conversations # pin a conversation
POST /api/workspaces/{workspaceId}/settings/pinned_users # pin a user
DELETE /api/workspaces/{workspaceId}/settings/pinned_channels # unpin a channel
DELETE /api/workspaces/{workspaceId}/settings/pinned_conversations # unpin a conversation
DELETE /api/workspaces/{workspaceId}/settings/pinned_users # unpin a user

POST /api/workspaces/{workspaceId}/channels # create a channel
POST /api/workspaces/{workspaceId}/channels/{channelId}/archive # archive a channel
POST /api/workspaces/{workspaceId}/channels/{channelId}/unarchive # unarchive a channel
POST /api/workspaces/{workspaceId}/channels/{channelId}/join # join a channel (important for public channels)
POST /api/workspaces/{workspaceId}/channels/{channelId}/leave # leave a channel

POST /api/workspaces/{workspaceId}/members # add a member to the workspace
DELETE /api/workspaces/{workspaceId}/members/{userId} # remove a member from the workspace

POST /api/workspaces/{workspaceId}/messages # create a message
POST /api/workspaces/{workspaceId}/messages/{messageId}/react # react to a message
DELETE /api/workspaces/{workspaceId}/messages/{messageId}/react # remove a reaction from a message

POST /api/workspaces/{workspaceId}/conversations # create a conversation
POST /api/workspaces/{workspaceId}/conversations/{conversationId}/archive # archive a conversation
POST /api/workspaces/{workspaceId}/conversations/{conversationId}/unarchive # unarchive a conversation
POST /api/workspaces/{workspaceId}/conversations/{conversationId}/watch # follow a conversation
POST /api/workspaces/{workspaceId}/conversations/{conversationId}/unwatch # follow a conversation
POST /api/workspaces/{workspaceId}/conversations/{conversationId}/notify-level # set the notify level for a conversation
```

Local state in the UI:

- Last opened channels/conversations
