# Sidebar & Input Exploration - Design Decisions

This folder contains HTML mockups for exploring Threa's navigation, thread panels, and message input designs. Below are the locked-in decisions from the exploration process.

## Thread Panel System

**Reference:** `nav-19-hybrid-resizable.html`

| Decision                | Details                                                      |
| ----------------------- | ------------------------------------------------------------ |
| **Panel modes**         | Overlay → Locked (pinned) → Full-screen                      |
| **Overlay behavior**    | Single thread only, appears over main stream                 |
| **Locked panel**        | Supports tabs for multiple threads, pushes main stream aside |
| **Resizable**           | Drag handle on left edge, snap points for min/max            |
| **Breadcrumbs**         | Show first 2 + "..." + last 2 for deep nesting (>4 levels)   |
| **Breadcrumb ellipsis** | Should open dropdown to select hidden levels (TODO)          |
| **Nested threads**      | Stack with depth indicators, breadcrumb navigation           |
| **Minimized threads**   | Strip at bottom with activity indicators                     |

**Pending refinements:**

- Sidebar hover behavior needs polish
- Expand button should go true full-screen (not half-page)

## Message Input System

**References:** `input-exploration-01.html`, `input-exploration-02-interactions.html`, `input-exploration-03-growth.html`

### Base Input Style

| Decision          | Details                                                   |
| ----------------- | --------------------------------------------------------- |
| **Style**         | Premium Glow (subtle gold glow on focus)                  |
| **Layout**        | Attachment bar above, text input below, send button right |
| **Expand button** | Left of input, opens document editor modal                |

### Growth Behavior

| Component          | Behavior                                              |
| ------------------ | ----------------------------------------------------- |
| **Strategy**       | Push (stream shrinks, input grows upward)             |
| **Auto-scroll**    | Stream auto-scrolls to bottom as input grows          |
| **Text input**     | 40px min → grows → 200px max → internal scroll        |
| **Attachment bar** | 0px (hidden when empty) → 120px max → internal scroll |
| **Total input**    | ~380px max to maintain 200px minimum stream view      |

### Floating Selection Toolbar

| Decision       | Details                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| **Style**      | Icon-only (Style 1)                                                      |
| **Position**   | Appears above selected text                                              |
| **Actions**    | Bold, Italic, Strikethrough, Code, Link                                  |
| **AI actions** | Not on own text; "Ask AI" available when selecting OTHER users' messages |

### Attachments

| State            | Style                                                   |
| ---------------- | ------------------------------------------------------- |
| **Uploaded**     | Primary accent (gold border, gold tint background)      |
| **Uploading**    | Dashed mono border + spinner icon                       |
| **Inline refs**  | `[Image #1]`, `[filename.ext]` as styled chips          |
| **Independence** | Removing inline ref does NOT remove attachment from bar |

### Emoji Picker

| Context             | Behavior                                    |
| ------------------- | ------------------------------------------- |
| **Reactions**       | Standard picker with categories             |
| **Inline (`:smi`)** | Use typed text as search, no top bar needed |

### Slash Commands

| Decision            | Details                                                   |
| ------------------- | --------------------------------------------------------- |
| **Style**           | Floating pill                                             |
| **Sorting**         | By relevance (best match at top), NOT grouped by type     |
| **Type indicators** | Icons and/or colors indicate command type                 |
| **Scope**           | Both backend actions AND frontend formatting (bold, etc.) |

### Mentions

| Decision     | Details                                               |
| ------------ | ----------------------------------------------------- |
| **Style**    | Floating compact                                      |
| **Sorting**  | By relevance (best match at top), NOT grouped by type |
| **Triggers** | `@` for users/personas, `#` for channels              |

### Document Editor

| Decision          | Details                                                                       |
| ----------------- | ----------------------------------------------------------------------------- |
| **Trigger**       | Expand button (↗) in input area                                               |
| **Layout**        | Modal overlay with header, toolbar, body, footer                              |
| **Toolbar**       | Full formatting: headings, lists, quotes, links, attachments, mentions, emoji |
| **Send behavior** | Explicit "Send Message" button (no Enter-to-send)                             |
| **Features**      | Preview mode, draft auto-save, schedule send                                  |
| **Use cases**     | Announcements, long-form content, when accidental send is costly              |

## Mockup Files

| File                                     | Purpose                                |
| ---------------------------------------- | -------------------------------------- |
| `nav-01.html` through `nav-16.html`      | Navigation evolution explorations      |
| `nav-17-thread-panels.html`              | Notion-style panel modes exploration   |
| `nav-18-thread-tabs.html`                | Tab-based multi-thread exploration     |
| `nav-19-hybrid-resizable.html`           | **Final** thread panel design          |
| `input-exploration-01.html`              | 8 input design variants                |
| `input-exploration-02-interactions.html` | Popovers, toolbar, attachments         |
| `input-exploration-03-growth.html`       | Growth behavior, document editor       |
| `conversations-overview-01.html`         | Stream list redesign with previews     |
| `typography-exploration-01.html`         | Font comparison (Space Grotesk chosen) |
| `quick-switcher-01.html`                 | Quick switcher redesign                |

## Conversations Overview

**Reference:** `conversations-overview-01.html`

### Stream Items (Enhanced)

| Element          | Details                                                         |
| ---------------- | --------------------------------------------------------------- |
| **Avatar**       | Icon/emoji for type (# channel, 📝 scratchpad, initials for DM) |
| **Name**         | Stream name, truncated with ellipsis                            |
| **Preview**      | `Author: Message preview...` (truncated)                        |
| **Time**         | Relative time (5m, 2h, 3d)                                      |
| **Unread badge** | Count if > 0                                                    |
| **Activity dot** | Pulsing indicator for very recent activity                      |

### Organization

| Feature            | Details                                                |
| ------------------ | ------------------------------------------------------ |
| **Pinned section** | User-controlled favorites, always visible at top       |
| **Default sort**   | By recent activity (most recent first)                 |
| **Alt sort**       | Alphabetical (user toggle)                             |
| **Mixed types**    | Channels, scratchpads, DMs sorted together by activity |

### Hover Actions

| Action          | Available on  |
| --------------- | ------------- |
| **Pin/Unpin**   | All streams   |
| **Mute/Unmute** | Channels, DMs |
| **Rename**      | Scratchpads   |
| **More menu**   | All streams   |

### Phase 2: AI-Powered Status

| Section             | Description                                    |
| ------------------- | ---------------------------------------------- |
| **Needs Attention** | Questions waiting on you, mentions, follow-ups |
| **Active**          | Recent activity, ongoing conversations         |
| **Quiet**           | No recent activity, collapsed by default       |

## Typography

**Reference:** `typography-exploration-01.html`

| Decision           | Details                                                     |
| ------------------ | ----------------------------------------------------------- |
| **Primary font**   | Space Grotesk (Google Fonts)                                |
| **Fallback**       | System UI stack for accessibility option                    |
| **Character**      | Geometric, technical, modern - fits "AI-native" positioning |
| **Weights needed** | 400 (regular), 500 (medium), 600 (semibold), 700 (bold)     |

**Implementation notes:**

- Add Google Fonts import to `index.html`
- Update Tailwind config to set as default sans-serif
- Keep system fonts as accessibility option (`data-font-family="system"`)

```html
<!-- Add to index.html head -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
```

```css
/* Update index.css or tailwind config */
body {
  font-family: "Space Grotesk", system-ui, sans-serif;
}
```

## Future Ideas (Parked)

- Slash command to create scratchpad with current context
- "Rewrite with AI" for messages
- Ask AI on highlighted text in other users' messages
