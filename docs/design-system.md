# Threa Design System

A comprehensive reference for Threa's visual design language. Use this document when implementing UI components and patterns.

**Design Philosophy:** Bold, modern, "AI-native" aesthetic for professionals at tech companies. The golden thread motif (inspired by Ariadne) provides warmth and distinction without being flashy.

**Visual Reference:** See `docs/design-system-kitchen-sink.html` for a complete interactive demo of all components and patterns with working code examples. The kitchen sink should be updated whenever new components or patterns are added.

---

## Typography

### Primary Font: Space Grotesk

A geometric sans-serif with technical character. Gives Threa a distinctive, modern feel that stands out from generic system fonts.

**Source:** Google Fonts (free)

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
```

**Weights:**
| Weight | Usage |
|--------|-------|
| 400 | Body text, descriptions |
| 500 | UI labels, meta text |
| 600 | Headings, emphasis |
| 700 | Hero text, titles |

**Fallback Stack:**

```css
font-family:
  "Space Grotesk",
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

### Accessibility Options

Users can override the default font:

- **System** - Native system fonts
- **Monospace** - For users who prefer fixed-width
- **OpenDyslexic** - For users with dyslexia

---

## Color System

### The Golden Thread Theme

Warm neutrals with gold/amber accents. The gold appears sparingly as the "guiding thread" through the interface.

### Light Mode

```css
:root {
  /* Base canvas - subtle warm tint */
  --background: 40 20% 98%;
  --foreground: 30 10% 12%;

  /* Cards/popovers */
  --card: 40 15% 99%;
  --card-foreground: 30 10% 12%;
  --popover: 40 15% 99%;
  --popover-foreground: 30 10% 12%;

  /* Primary - The Golden Thread */
  --primary: 38 65% 50%;
  --primary-foreground: 40 20% 98%;

  /* Secondary */
  --secondary: 35 10% 92%;
  --secondary-foreground: 30 15% 25%;

  /* Muted */
  --muted: 35 12% 93%;
  --muted-foreground: 30 8% 45%;

  /* Accent */
  --accent: 40 50% 94%;
  --accent-foreground: 35 60% 35%;

  /* Borders and inputs */
  --border: 35 15% 88%;
  --input: 35 15% 88%;
  --ring: 38 65% 50%;

  /* Sidebar */
  --sidebar-background: 35 15% 96%;
  --sidebar-foreground: 30 10% 25%;
}
```

### Dark Mode

```css
.dark {
  /* Base canvas - deep charcoal with warmth */
  --background: 30 15% 8%;
  --foreground: 35 15% 92%;

  /* Cards/popovers */
  --card: 30 12% 11%;
  --card-foreground: 35 15% 92%;
  --popover: 30 12% 11%;
  --popover-foreground: 35 15% 92%;

  /* Primary - adjusted for dark */
  --primary: 40 55% 55%;
  --primary-foreground: 30 15% 8%;

  /* Secondary */
  --secondary: 30 10% 18%;
  --secondary-foreground: 35 12% 85%;

  /* Muted */
  --muted: 30 10% 15%;
  --muted-foreground: 35 10% 55%;

  /* Accent */
  --accent: 35 25% 18%;
  --accent-foreground: 40 45% 70%;

  /* Borders and inputs */
  --border: 30 10% 20%;
  --input: 30 10% 15%;
  --ring: 40 55% 55%;

  /* Sidebar */
  --sidebar-background: 30 15% 6%;
  --sidebar-foreground: 35 12% 85%;
}
```

### Semantic Colors

| Purpose        | Color              | Usage                           |
| -------------- | ------------------ | ------------------------------- |
| **Channel**    | `--primary`        | Channel icons, # symbol         |
| **Scratchpad** | `hsl(280 60% 70%)` | Purple tint for personal spaces |
| **DM**         | `--secondary`      | Neutral for direct messages     |
| **Command**    | `hsl(200 60% 70%)` | Blue tint for actions           |
| **Search**     | `hsl(150 60% 70%)` | Green tint for search results   |
| **Hot/Active** | `--primary`        | Activity indicators             |
| **Stalled**    | `hsl(45 70% 60%)`  | Yellow for attention needed     |

---

## Spacing & Radius

### Border Radius

| Element            | Radius                   |
| ------------------ | ------------------------ |
| **Modals/Dialogs** | 16px                     |
| **Cards**          | 12px                     |
| **Buttons**        | 8-10px                   |
| **Inputs**         | 12px                     |
| **Items (list)**   | 8-10px                   |
| **Badges/Pills**   | 6px (small), 20px (pill) |
| **Avatars**        | 8px                      |

### Standard Spacing

Use multiples of 4px. Common values:

- **4px** - Tight gaps
- **8px** - Default gap
- **12px** - Comfortable padding
- **16px** - Section padding
- **20px** - Modal padding
- **24px** - Section margins

---

## Components

### Message Input

**Style:** Premium Glow

```css
.input-wrapper {
  position: relative;
  background: hsl(var(--input));
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
}

.input-glow {
  position: absolute;
  inset: -2px;
  border-radius: 14px;
  background: linear-gradient(135deg, hsl(var(--primary) / 0.2), hsl(var(--primary) / 0.05), hsl(var(--primary) / 0.2));
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}

.input-wrapper:focus-within .input-glow {
  opacity: 1;
}
```

**Height Limits:**
| Component | Min | Max |
|-----------|-----|-----|
| Text input | 40px | 200px (then internal scroll) |
| Attachment bar | 0 (hidden) | 120px (then internal scroll) |
| Total input area | 64px | ~380px |

**Growth Behavior:** Push (stream view shrinks, auto-scrolls to bottom)

### Floating Selection Toolbar

**Style:** Icon-only

Appears above selected text for formatting actions.

```css
.selection-toolbar {
  display: flex;
  gap: 2px;
  padding: 4px;
  background: hsl(var(--popover));
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  box-shadow: 0 4px 12px hsl(0 0% 0% / 0.2);
}

.toolbar-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: hsl(var(--muted-foreground));
  transition: all 0.15s;
}

.toolbar-btn:hover {
  background: hsl(var(--secondary));
  color: hsl(var(--foreground));
}
```

**Actions:** Bold, Italic, Strikethrough, Code, Link

### Attachments

**Uploaded State:**

```css
.attachment-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: hsl(var(--primary) / 0.1);
  border: 1px solid hsl(var(--primary) / 0.3);
  border-radius: 8px;
  font-size: 12px;
  color: hsl(var(--primary));
}
```

**Uploading State:**

```css
.attachment-chip.uploading {
  border-style: dashed;
  background: transparent;
  color: hsl(var(--muted-foreground));
  border-color: hsl(var(--border));
}
/* Include spinner icon */
```

**Inline References:**

```css
.inline-ref {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: hsl(var(--primary) / 0.15);
  border: 1px solid hsl(var(--primary) / 0.3);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--primary));
  vertical-align: middle;
}
```

Format: `[Image #1]`, `[filename.ext]`

### Code Blocks

**Reference:** `design-system-kitchen-sink.html` section "CODE BLOCK WITH HEADER"

Code blocks use a Linear-inspired header design with language picker (editing mode) or copy button (viewing mode).

**Header:**

```css
.code-block {
  border-radius: 10px;
  background: hsl(var(--muted) / 0.5);
  border: 1px solid hsl(var(--border));
  overflow: hidden;
}

.code-block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: hsl(var(--muted) / 0.5);
  border-bottom: 1px solid hsl(var(--border));
  min-height: 36px;
}
```

**Language Picker (Editing):**
Dropdown on right side of header for selecting syntax highlighting.

**Copy Button (Viewing):**
Appears on hover, shows checkmark when copied.

```css
.code-block-copy {
  width: 28px;
  height: 28px;
  opacity: 0;
  transition: opacity 0.15s;
}

.code-block:hover .code-block-copy {
  opacity: 1;
}

.code-block-copy.copied {
  background: hsl(var(--success) / 0.15);
  color: hsl(var(--success));
}
```

### Image Attachments & Gallery

**Reference:** `design-system-kitchen-sink.html` section "IMAGE ATTACHMENTS & GALLERY"

**Single Image:**

```css
.image-preview.single {
  max-width: 400px;
  max-height: 300px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  cursor: pointer;
}
```

**Multiple Images:**
Grid layout with fixed size:

```css
.image-preview-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.image-preview.multi {
  width: 180px;
  height: 180px;
}
```

**"More" Overlay:**
When >4 images, show "+N more" on 4th thumbnail:

```css
.image-preview-overlay {
  position: absolute;
  inset: 0;
  background: hsl(0 0% 0% / 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 18px;
  font-weight: 600;
}
```

**Full-Screen Gallery:**
Click any image to open full-screen viewer with:

- Navigation arrows (prev/next)
- Thumbnail strip at bottom
- Download and close buttons
- Dark backdrop (95% black)

### Message Styling

**Reference:** `design-system-kitchen-sink.html` section "MESSAGE STYLING"

**Standard Message:**

```css
.message {
  display: flex;
  gap: 14px;
  margin-bottom: 20px;
}

.message-avatar {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  flex-shrink: 0;
}
```

**AI Message (Special Styling):**
AI messages get a gold accent and subtle background:

```css
.message.ai {
  background: linear-gradient(90deg, hsl(var(--primary) / 0.06) 0%, transparent 100%);
  margin-left: -24px;
  margin-right: -24px;
  padding: 16px 24px;
  border-left: 3px solid hsl(var(--primary));
}

.message.ai .message-avatar {
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}

.message.ai .message-author {
  color: hsl(var(--primary));
}
```

This creates a subtle "golden thread" visual for AI contributions.

### Inline Mentions

**Reference:** `design-system-kitchen-sink.html` section "MENTIONS"

Inline mentions in message text use subtle backgrounds:

```css
.inline-mention {
  display: inline;
  padding: 1px 4px;
  border-radius: 4px;
  font-weight: 500;
  cursor: pointer;
}

/* User mentions */
.inline-mention.user {
  background: hsl(200 70% 50% / 0.1);
  color: hsl(200 70% 50%);
}

/* AI persona mentions */
.inline-mention.ai {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

/* Channel mentions */
.inline-mention.channel {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
}

/* Current user (me) - stronger highlight */
.inline-mention.me {
  background: hsl(200 70% 50% / 0.15);
  color: hsl(var(--primary));
  font-weight: 600;
}
```

### Popovers

#### Emoji Picker

- **Style:** Standard with categories
- **Behavior:** When typing `:text`, use typed text as search (no top bar needed)

#### Slash Commands

- **Style:** Floating pill
- **Sorting:** By relevance (best match at top), NOT grouped by type
- **Type indicators:** Icons and/or colors indicate command type

```css
.command-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
}

.command-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

#### Mentions

- **Style:** Floating compact
- **Sorting:** By relevance (best match at top), NOT grouped by type
- **Triggers:** `@` for users/personas, `#` for channels

### Document Editor Modal

For long-form content and announcements.

```css
.doc-editor {
  width: 90%;
  max-width: 800px;
  max-height: 80vh;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}
```

**Features:**

- Full formatting toolbar
- No Enter-to-send (explicit Send button)
- Preview mode
- Draft auto-save
- Schedule send option

---

## Patterns

### Thread Panels

**Modes:**
| Mode | Behavior |
|------|----------|
| **Locked** | Side-by-side resizable layout (default), max 3 panels |
| **Full-screen** | Expands to fill entire view |

**Resize:** Drag handle between panels with 20% minimum width

**Breadcrumbs:** Full ancestor chain from root → intermediate threads → current thread. Each breadcrumb item truncates at 120px to prevent overflow.

**Panel Limit:** Maximum of 3 total panels (main stream + 2 thread panels). Opening a new panel when at limit automatically closes the oldest panel.

```css
.thread-panel {
  background: hsl(var(--card));
  border-left: 1px solid hsl(var(--border));
  display: flex;
  flex-direction: column;
}

.thread-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 12px;
  border-bottom: 1px solid hsl(var(--border));
  overflow-x: auto;
}

.thread-tab {
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  white-space: nowrap;
}

.thread-tab.active {
  background: hsl(var(--primary) / 0.15);
  color: hsl(var(--primary));
}
```

### Sidebar with Color Strip

**Reference:** `design-system-kitchen-sink.html` section "SIDEBAR"

The sidebar features a color strip on the left edge that provides at-a-glance activity information. The sidebar can collapse to just the color strip (like Linear).

**Structure:**

```css
.sidebar {
  display: flex;
  width: 280px; /* Expanded state */
}

.color-strip {
  width: 6px;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.color-segment {
  position: relative;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  transition: filter 0.15s;
}

.color-segment:hover {
  filter: brightness(1.15);
}
```

**Activity Stripes:**
Each color segment shows activity types through vertical stripes:

- Gold stripe - AI activity
- Red stripe - Mentions
- Blue stripe - People activity
- Muted stripe - Quiet/no activity

**Collapse Behavior:**

- Default: Collapsed to just color strip
- Hover: Preview expansion
- Click: Pin open (persists until clicked again)

**Label-Based Organization:**
Labels group streams across types (channels, scratchpads, threads) into meaningful collections:

```css
.label-section {
  margin-bottom: 4px;
}

.label-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  cursor: pointer;
}

.label-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: var(--label-color); /* User-defined */
}
```

### Conversations Overview (Sidebar Content)

**Stream Items (Enhanced):**

```css
.stream-item {
  display: flex;
  gap: 10px;
  padding: 10px;
  border-radius: 8px;
}

.stream-avatar {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stream-preview {
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stream-time {
  font-size: 11px;
  color: hsl(var(--muted-foreground));
}
```

**Organization:**

- Pinned section at top (user-controlled)
- Default sort: recent activity
- Mixed types sorted together

**Hover Actions:** Pin, Mute, Rename (scratchpads), More menu

### Quick Switcher

**Trigger:** `Cmd+K` (streams), `Cmd+Shift+K` (commands), `Cmd+Shift+F` (search)

```css
.quick-switcher {
  width: 100%;
  max-width: 580px;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 16px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}

.switcher-input-area {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid hsl(var(--border));
  gap: 12px;
}

/* Subtle glow on focus */
.switcher-input-area::before {
  content: "";
  position: absolute;
  inset: -1px;
  border-radius: 16px 16px 0 0;
  background: linear-gradient(135deg, hsl(var(--primary) / 0.15), transparent 50%, hsl(var(--primary) / 0.1));
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}

.switcher-input-area:focus-within::before {
  opacity: 1;
}
```

**Mode Tabs:** Pill style

```css
.mode-tab-pill {
  padding: 8px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 500;
  background: hsl(var(--secondary));
  border: 1px solid transparent;
}

.mode-tab-pill.active {
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.15);
  border-color: hsl(var(--primary) / 0.4);
}
```

**Items:** Include avatars, names, and message previews

**Search Results:** Highlight matches with gold background

```css
.search-result-text mark {
  background: hsl(var(--primary) / 0.3);
  color: hsl(var(--foreground));
  padding: 0 2px;
  border-radius: 2px;
}
```

**Footer:** Keyboard hints (↑↓ Navigate, ↵ Open, ⌘↵ New tab, esc Close)

### Top Bar

**Reference:** `design-system-kitchen-sink.html` section 15

The top bar provides workspace navigation and context.

```css
.top-bar {
  height: 44px;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  display: flex;
  align-items: center;
  padding: 0 12px;
}
```

**Layout:**

- Left: Sidebar toggle, workspace switcher (~100px width)
- Center: Context labels (stream/thread indicators) with activity glow
- Right: Search, notifications, profile (~100px width)

**Activity Glow:**
Active streams show a subtle multi-color glow at the bottom of their label:

```css
.stream-label-glow {
  position: absolute;
  bottom: 2px;
  left: 10px;
  right: 10px;
  height: 3px;
  border-radius: 2px;
  display: flex;
  overflow: hidden;
}

.glow-stripe {
  flex: 1;
  height: 100%;
  animation: glow-pulse 2s ease-in-out infinite;
}

@keyframes glow-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
```

Each active persona gets a color stripe in the glow, creating a visual "thread" of who's active.

---

## Animation & Motion

### Transitions

Default duration: `150ms` for micro-interactions, `200-300ms` for larger transitions.

```css
/* Micro-interactions */
transition: all 0.15s ease;

/* Panel/modal transitions */
transition: all 0.2s ease;

/* Glow/highlight effects */
transition: opacity 0.3s ease;
```

### Activity Indicators

Pulsing dot for recent activity:

```css
.activity-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: hsl(var(--primary));
}

.activity-dot.recent {
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
```

### Reduced Motion

Respect user preference:

```css
.reduced-motion *,
.reduced-motion *::before,
.reduced-motion *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
}
```

---

## Reference Files

### Kitchen Sink (Primary Reference)

`docs/design-system-kitchen-sink.html` - **THE** comprehensive reference with all components and patterns. This is a living document that should be updated whenever new UI components or patterns are added to the system.

The kitchen sink includes:

- Complete CSS implementation for all components
- Interactive examples with hover states
- Dark mode support
- All color variables and typography
- Working animations and transitions

**When to update:** Add new sections to the kitchen sink when implementing new UI patterns, components, or significant style changes. Keep it in sync with this document.

### Exploration Mockups

Historical explorations in `docs/references/mockups/sidebar-exploration/`:

| File                                     | Purpose                               |
| ---------------------------------------- | ------------------------------------- |
| `nav-19-hybrid-resizable.html`           | Thread panel system (final)           |
| `input-exploration-01.html`              | 8 input designs (Premium Glow chosen) |
| `input-exploration-02-interactions.html` | Popovers, toolbar, attachments        |
| `input-exploration-03-growth.html`       | Growth behavior, document editor      |
| `conversations-overview-01.html`         | Stream list redesign                  |
| `typography-exploration-01.html`         | Font comparison                       |
| `quick-switcher-01.html`                 | Quick switcher redesign               |

See `docs/references/mockups/sidebar-exploration/CLAUDE.md` for detailed decision logs.

---

## Implementation Checklist

When implementing a component, verify:

- [ ] Uses Space Grotesk font
- [ ] Follows color system (golden thread accents)
- [ ] Correct border radius (16px modals, 12px cards, 8-10px items)
- [ ] Appropriate spacing (multiples of 4px)
- [ ] Hover/focus states with gold accent
- [ ] Keyboard navigation support
- [ ] Respects reduced motion preference
- [ ] Dark mode tested
- [ ] **Kitchen sink updated** - Add new component/pattern to `design-system-kitchen-sink.html` with working example
