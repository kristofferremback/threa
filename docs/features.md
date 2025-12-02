# Threa UI Features Specification

This document describes the expected behavior of all visual components in Threa. Use this as a reference when making changes to ensure features are not accidentally removed or broken.

---

## Table of Contents

1. [Sidebar](#sidebar)
2. [Channel/Stream View](#channelstream-view)
3. [Thread View](#thread-view)
4. [Message Components](#message-components)
5. [Chat Input](#chat-input)
6. [Ariadne AI Components](#ariadne-ai-components)
7. [Pane System](#pane-system)
8. [Modals and Dialogs](#modals-and-dialogs)
9. [Navigation and Keyboard Shortcuts](#navigation-and-keyboard-shortcuts)

---

## Sidebar

**File:** `src/frontend/components/layout/Sidebar.tsx`

### Structure

The sidebar is fixed at 256px width and contains:

1. **Workspace Header**
   - Workspace name with initial letter avatar
   - Plan tier display (mono font)
   - Invite people button (UserPlus icon)

2. **Search Bar**
   - "Find channels..." placeholder text
   - Opens command palette on click
   - Shows `⌘P` keyboard shortcut hint

3. **Quick Access Section**
   - **Activity** button with Bell icon
     - Shows unread count badge (red pill, max "99+")
     - Bold text when has unreads
     - Highlighted background when active
   - **Knowledge** button with BookOpen icon (optional)

4. **Pinned Channels Section** (if any pinned)
   - Header: "PINNED" (uppercase, muted)
   - List of pinned channels

5. **Channels Section**
   - Header: "CHANNELS" with Browse (Compass) and Add (Plus) buttons
   - Empty state when no channels:
     - Compass icon
     - "No channels yet" heading
     - "Join a channel to start collaborating" text
     - "Browse channels" primary button
     - "Create channel" secondary button

6. **Thinking Spaces Section**
   - Header: "THINKING SPACES" with Add (Plus) button
   - Empty state: "Start thinking with Ariadne..." button with Brain icon
   - List of thinking spaces with Brain icon

7. **Direct Messages Section**
   - Header: "DIRECT MESSAGES" with Add (Plus) button
   - Group DMs shown first (MessageCircle icon)
   - Individual users with Avatar
   - Users with existing DMs sorted by recency
   - Users without DMs sorted alphabetically

8. **User Footer**
   - Current user avatar (medium)
   - Display name
   - Title or "Online" status with green dot
   - Settings dropdown (cog icon):
     - Theme selector
     - Edit profile
     - Preferences
     - Sign out (danger style)

### Channel/Stream Item Behaviors

Each stream item supports:
- **Click**: Open in main pane (replace current tab)
- **⌥+Click (Alt+Click)**: Open in side pane
- **⌘+Click (Cmd+Click)**: Open in new browser tab
- **Hover actions** (appear on hover):
  - Panel icon: Open to side
  - More menu (⋯):
    - Pin/Unpin channel
    - Channel settings
    - Leave channel (danger)
- **Unread badge**: Purple pill showing count
- **Bold text** when has unread messages
- **Icon colors**: Accent primary when active, muted otherwise

### Thinking Space Item Behaviors

Same as channels, but:
- Uses Brain icon instead of Hash
- More menu only has "Archive space" option

### DM Item Behaviors

Same interaction patterns, but:
- Uses Avatar for individual users
- Uses MessageCircle for group DMs
- Pin/Unpin conversation options

---

## Channel/Stream View

**File:** `src/frontend/components/StreamInterface.tsx`

### Structure

1. **Chat Header** (`ChatHeader.tsx`)
   - Stream title
   - Thread indicator (if thread)
   - Connection status indicator

2. **Thread Context** (threads only) - see [Thread View](#thread-view)

3. **Message List Area** (`EventList.tsx` → `MessageList.tsx`)
   - Scrollable container
   - Messages sorted chronologically (oldest first)
   - "Load older messages" button at top when more available
   - Loading spinner when fetching more

4. **Chat Input** - see [Chat Input](#chat-input)

### Message List Behaviors

- **Auto-scroll**:
  - On channel switch: scroll to first unread or bottom
  - On new messages: scroll to bottom only if user was already at bottom
- **Infinite scroll**: Load more when scrolling near top
- **Scroll position preservation**: When loading older messages, maintain visual position
- **Unread divider**: Red line with "New messages" text between read/unread
- **Read tracking**: Blue left border on unread messages

---

## Thread View

**Files:**
- `src/frontend/components/chat/ThreadContext.tsx`
- `src/frontend/components/chat/StickyThreadHeader.tsx`
- `src/frontend/components/chat/MessageList.tsx`

### Thread Context Bar

Shown at top of thread view when `isThread && parentStream` is true:

1. **Channel Breadcrumb**
   - Back arrow + Hash icon + Channel name
   - Clicking navigates to parent channel
   - Supports click modifiers (⌥/⌘)

2. **Collapsible Ancestors Section** (for nested threads)
   - Toggle button: "Show X parent messages" / "Hide context"
   - Collapsed by default
   - Shows ancestor messages from nested thread chain
   - **Note**: The immediate parent (root event) is NOT shown here - it's displayed in the message list as "Thread started from"
   - Each ancestor shows:
     - Author name
     - Timestamp
     - Message content (truncated)
     - "View thread" link + side panel button

### Root Message Display

In the message list for threads:

1. **"Thread started from" label** - Purple badge
2. **Root message content**:
   - Avatar + Author name + Timestamp
   - Full message content
   - Separator line (if has replies)

### Sticky Thread Header

Appears when root message scrolls out of view:

- **Trigger**: IntersectionObserver detects root message not visible
- **Position**: Absolute top, z-10
- **Content** (collapsed):
  - Avatar (xs)
  - Author name (truncated)
  - Message preview (60 chars max)
  - Timestamp
  - Chevron down icon
- **Content** (expanded):
  - Full message content on click
  - Chevron up icon
- **Style**: Secondary background, subtle border, drop shadow

### Empty Thread State

When thread has no replies:
- MessageCircle icon (8x8, 50% opacity)
- "No replies yet. Start the conversation!" text

---

## Message Components

**Files:**
- `src/frontend/components/chat/MessageItem.tsx`
- `src/frontend/components/chat/MessageContent.tsx`
- `src/frontend/components/chat/SystemMessage.tsx`

### Message Item Structure

1. **Header Row**
   - Avatar (small)
   - Author display name
   - Timestamp (relative, mono font)
   - Edit indicator "(edited X ago)" - clickable to show revisions
   - Pending indicator: Loader spinner + "Sending..."
   - Failed indicator: Warning icon + "Will retry automatically" + "Retry now" link
   - Hover actions (right side):
     - Edit button (own messages only, Pencil icon)
     - More menu (⋯)

2. **Content Area** (indented under avatar)
   - Shared from badge (if cross-posted)
   - Message content with:
     - Markdown rendering (bold, italic, code)
     - @mentions (highlighted, clickable)
     - #channels (highlighted, clickable)
     - Links
   - Channel badges (if multi-channel conversation)

3. **Thread Actions** (hover to show if no replies)
   - If has replies:
     - Reply count with MessageCircle icon
     - "Ariadne is thinking" badge (if active session)
     - Side panel button
   - If no replies:
     - "Reply in thread" link
     - Side panel button

### Message States

- **Default**: Transparent background
- **Hover**: `var(--hover-overlay)` background
- **Unread**: `var(--unread-bg)` background + 3px blue left border
- **Unread hover**: `var(--unread-bg-hover)` background
- **Highlighted**: Yellow background + yellow left border + pulse animation
- **Editing**: `var(--hover-overlay)` background

### Inline Editing

When editing a message:
1. RichTextEditor replaces content
2. Hint text: "Press Enter to save, Escape to cancel"
3. Cancel (X) and Save (Check) buttons
4. Escape key cancels
5. Enter key saves

### Context Menu

Right-click or More button opens menu with:
- Edit (own messages)
- View edit history (if edited)
- Reply in thread
- Share to channel (thread replies only)
- Cross-post to channel
- Mark as read/unread
- Copy message text

### System Messages

Rendered differently for events like:
- member_joined
- member_left
- stream_created

Styled as centered, muted text.

---

## Chat Input

**File:** `src/frontend/components/chat/ChatInput.tsx`

### Structure

1. **Rich Text Editor** (`RichTextEditor.tsx`)
   - Multi-line input
   - Markdown support: `**bold**`, `*italic*`, `` `code` ``
   - @mention autocomplete (users)
   - #channel autocomplete (channels)
   - Auto-resize

2. **Send Button**
   - Send icon
   - Loading spinner when sending

3. **Help Text Row**
   - Left: Formatting hints
     - "Enter to send, Shift+Enter for newline"
     - "**bold** *italic* `code` @mentions #channels"
   - Right: Draft status
     - "Saving..." (pulsing)
     - "Draft saved" (with FileText icon)

### Behaviors

- **Auto-focus**: Focus on mount and after sending
- **Draft persistence**:
  - Saves to IndexedDB after 500ms debounce
  - Loads draft when switching streams
  - Clears draft on send
- **Submit**: Enter key or click Send button
- **Newline**: Shift+Enter

### Mention Autocomplete

Triggered by `@` for users or `#` for channels:
- Popup list appears below cursor
- Filter as user types
- Arrow keys to navigate
- Enter/Tab to select
- Escape to close
- Click to select

---

## Ariadne AI Components

### Agent Thinking Event

**File:** `src/frontend/components/chat/AgentThinkingEvent.tsx`

Displays inline in chat when Ariadne is processing.

#### Structure

1. **Header** (always visible, clickable)
   - Ariadne avatar (gradient purple/blue, Sparkles icon)
   - "Ariadne" label
   - Status badge:
     - Active: Purple badge with spinner + current step type
     - Failed: Red badge with X icon
     - Completed: "thought for Xs · N tools used"
   - Expand/collapse chevron

2. **Summary** (collapsed, completed only)
   - Brief description of what was done

3. **Step Timeline** (expanded)
   - List of steps with:
     - Expand chevron (if has details)
     - Status icon: Spinner (active), Check (completed), X (failed)
     - Step description
     - Duration (e.g., "1.2s")
   - Tool call steps are expandable:
     - Input JSON
     - Result preview (with copy/expand buttons)
     - Search results show clickable items

#### Step Types

- `gathering_context` - FileText icon, "Gathering context"
- `reasoning` - Brain icon, "Thinking"
- `tool_call` - Wrench icon, "Using tool"
- `synthesizing` - Sparkles icon, "Preparing response"

#### Tool Result Viewer

**File:** `src/frontend/components/chat/ToolResultViewer.tsx`

For expanded tool results:
- Copy button
- Maximize button (opens in panel)
- Search results: Clickable items that navigate to source messages
- Other results: Preformatted text (truncated with "...")

### Ariadne Thinking Indicator

**File:** `src/frontend/components/chat/AriadneThinkingIndicator.tsx`

Simple inline badge showing "Ariadne is thinking" with spinner.
Used in message items when session is active in a thread.

---

## Pane System

**File:** `src/frontend/components/layout/PaneSystem.tsx`

### Overview

Multi-pane layout allowing side-by-side views.

### Structure

1. **Horizontal PanelGroup** (resizable-panels library)
2. **Each Pane**:
   - Tab bar at top
   - Content area (fills remaining space)
   - Resize handle between panes

### Tab Bar

Each tab shows:
- Icon (Hash for channels, MessageCircle for threads, Bell for inbox)
- Label (stream name)
- Close button (X, appears on hover)

### Behaviors

- **Focus**: Click pane to focus (visual indicator)
- **Resize**: Drag handle between panes
- **Min width**: 20% per pane
- **Close tab**: X button or middle-click
- **Empty state**: "Select a channel to start" with Hash icon

---

## Modals and Dialogs

### Command Palette

**File:** `src/frontend/components/layout/CommandPalette.tsx`

- **Trigger**: ⌘K or ⌘P, or click search bar
- **Features**:
  - Search across channels, DMs, users
  - Recent items
  - Arrow key navigation
  - Enter to select

### Create Channel Modal

**File:** `src/frontend/components/layout/CreateChannelModal.tsx`

- Channel name input (auto-generates slug)
- Description (optional)
- Visibility toggle (public/private)

### Browse Channels Modal

**File:** `src/frontend/components/layout/BrowseChannelsModal.tsx`

- List of all public channels
- Search/filter
- Join button per channel

### Channel Settings Modal

**File:** `src/frontend/components/layout/ChannelSettingsModal.tsx`

- Edit name, description, topic
- Change visibility
- View members
- Leave/archive options

### Invite Modal

**File:** `src/frontend/components/InviteModal.tsx`

- Email input for inviting users
- Copy invite link

### Profile Setup Modal

**File:** `src/frontend/components/layout/ProfileSetupModal.tsx`

- Display name
- Title/role
- Avatar (generated from name)

### Knowledge Browser Modal

**File:** `src/frontend/components/layout/KnowledgeBrowserModal.tsx`

- Browse saved memos/knowledge
- Search functionality

### Confirm Modal

**File:** `src/frontend/components/ui/ConfirmModal.tsx`

- Generic confirmation dialog
- Title, message, confirm/cancel buttons

---

## Navigation and Keyboard Shortcuts

### Global Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘K` or `⌘P` | Open command palette |
| `⌘/` | Show keyboard shortcuts |
| `Escape` | Close modal/cancel action |

### Message Actions

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | New line in message |
| `Escape` | Cancel edit |
| `↑` (in empty input) | Edit last message |

### Navigation Modifiers

| Modifier | Effect |
|----------|--------|
| Click | Replace current tab |
| `⌥+Click` (Alt) | Open in side pane |
| `⌘+Click` (Cmd) | Open in new browser tab |

---

## Offline Support

**File:** `src/frontend/components/OfflineBanner.tsx`

### Offline Banner

Shows when connection lost:
- Yellow/amber background
- "You're offline" message
- Auto-hides when reconnected

### Message Outbox

- Messages saved to localStorage before sending
- Pending messages show spinner
- Failed messages show retry option
- Auto-retry on reconnect

### Draft Persistence

- Drafts saved to IndexedDB
- Per-stream drafts
- Restored on page load

---

## Connection Status

### WebSocket Connection

Visual indicators:
- **Connected**: Green dot in header/footer
- **Connecting**: Yellow dot with pulse
- **Disconnected**: Red dot, shows reconnection message

### Connection Error

**File:** `src/frontend/components/chat/ConnectionError.tsx`

Full-screen error state when can't load stream:
- Error message
- Retry button

---

## Theme Support

**File:** `src/frontend/components/ui/ThemeToggle.tsx`

Three theme options:
- Light
- Dark
- System (follows OS preference)

Selector in user footer dropdown.

CSS variables adapt all colors.

---

## Maintenance Notes

When modifying components, verify:

1. **Thread view**: Breadcrumbs, ancestors, root message, sticky header all work
2. **Message states**: Pending, failed, unread, highlighted all display correctly
3. **Navigation**: Click modifiers (⌥, ⌘) work throughout
4. **Real-time**: WebSocket events update UI immediately
5. **Offline**: Drafts persist, messages queue correctly
6. **Accessibility**: Keyboard navigation, focus management
7. **Responsive**: Pane resizing, mobile considerations

---

*Last updated: 2025-12-01*
