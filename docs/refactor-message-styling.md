# Message Styling Refactor - Design System Alignment

**Goal**: Make messages clean and minimal like the design system. Remove the bulky feel.

**Reference**:

- `docs/design-system.md` - Section "MESSAGE STYLING"
- `docs/design-system-kitchen-sink.html` - Lines 1729-1818
- `docs/references/mockups/sidebar-exploration/nav-16-full-view.html` - Lines 493-568

## Core Principle

**Regular messages should be invisible** - just content on the page with minimal visual treatment.
**AI messages get the golden thread treatment** - gradient background, gold border, full-width.

## Changes Required

### 1. MessageLayout Component (`message-event.tsx`)

**Current problems:**

- All messages get rounded corners and backgrounds
- Regular messages break out with negative margins (should only be AI)
- Avatar is too small (32px vs 36px)
- Gap between avatar and content is too small (12px vs 14px)

**Changes:**

```tsx
// BEFORE (lines 64-74)
<div
  ref={containerRef}
  className={cn(
    "message-item group flex gap-3 rounded-lg",
    isPersona
      ? "bg-gradient-to-r from-primary/[0.06] to-transparent -mx-6 px-6 py-4 border-l-[3px] border-l-primary"
      : "bg-gradient-to-br from-muted/[0.03] to-transparent py-3 px-3 -mx-3",
    isHighlighted && "animate-highlight-flash",
    containerClassName
  )}
>
  <Avatar className="message-avatar h-8 w-8 shrink-0">

// AFTER
<div
  ref={containerRef}
  className={cn(
    "message-item group flex gap-[14px] mb-5",
    // AI/Persona messages get full-width gradient with gold accent
    isPersona &&
      "bg-gradient-to-r from-primary/[0.06] to-transparent -mx-6 px-6 py-4 border-l-[3px] border-l-primary",
    isHighlighted && "animate-highlight-flash",
    containerClassName
  )}
>
  <Avatar className="message-avatar h-9 w-9 rounded-[10px] shrink-0">
```

**Key points:**

1. Remove `rounded-lg` from all messages
2. Remove background/padding/margins from regular messages
3. Change gap from `gap-3` (12px) to `gap-[14px]` (14px)
4. Add `mb-5` (20px) to all messages
5. Change avatar from `h-8 w-8` to `h-9 w-9` (32px → 36px)
6. Add explicit `rounded-[10px]` to avatar

### 2. Container Padding (`event-list.tsx`)

The message container needs proper padding to accommodate the AI message breakout:

```tsx
// BEFORE (event-list.tsx line 118)
<div className="flex flex-col gap-1 p-4 mx-auto max-w-[800px] w-full min-w-0">

// AFTER
<div className="flex flex-col p-6 mx-auto max-w-[800px] w-full min-w-0">
```

**Changes:**

1. Change `p-4` (16px) to `p-6` (24px) - matches AI message `-mx-6` breakout
2. Remove `gap-1` - messages now handle their own `mb-5` spacing

**Why**: AI messages use `-mx-6 px-6` to break out to full container width. The container needs 24px padding to accommodate this.

### 3. Avatar Styling Consistency

Check that AvatarFallback uses correct styling:

```tsx
// Current (line 77)
<AvatarFallback className={cn(isPersona && "bg-primary/20 text-primary")}>

// Should be (from design system)
<AvatarFallback
  className={cn(
    "bg-muted text-foreground",  // Default for users
    isPersona && "bg-primary text-primary-foreground"  // AI gets gold background
  )}
>
```

**Design system reference** (kitchen-sink lines 1811-1813):

- AI avatar: `background: hsl(var(--primary)); color: hsl(var(--primary-foreground));`
- User avatar: `background: hsl(var(--muted)); color: hsl(var(--foreground));`

### 4. Message Header Spacing

```tsx
// Current (line 80-84)
<div className="flex items-baseline gap-2">
  <span className="font-medium text-sm">{actorName}</span>
  {statusIndicator}
  {actions}
</div>

// Should match design (kitchen-sink lines 1754-1759)
<div className="flex items-baseline gap-2 mb-1">
  <span className="font-semibold text-sm">{actorName}</span>
  {statusIndicator}
  {actions}
</div>
```

**Changes:**

- Add `mb-1` (4px) after header
- Change `font-medium` to `font-semibold` (500 → 600 weight)

### 5. Content Margin

```tsx
// Current (line 86)
<MarkdownContent content={payload.content} className="mt-0.5 text-sm" />

// Should be (kitchen-sink line 1773)
<MarkdownContent content={payload.content} className="text-sm leading-relaxed" />
```

Remove `mt-0.5` since header already has `mb-1`.

### 6. AI Author Name Color

```tsx
// In MessageLayout, add className to author name for AI messages
<span
  className={cn(
    "font-semibold text-sm",
    isPersona && "text-primary" // Gold color for AI name
  )}
>
  {actorName}
</span>
```

**Design reference** (kitchen-sink lines 1816-1818):

```css
.message.ai .message-author {
  color: hsl(var(--primary));
}
```

## Testing Checklist

After implementing changes, verify:

- [ ] Regular messages have NO background
- [ ] Regular messages have NO rounded corners
- [ ] Regular messages have NO negative margins
- [ ] AI messages break out to full width with gold gradient
- [ ] AI messages have 3px gold left border
- [ ] Avatar is 36×36px (not 32×32px)
- [ ] Avatar has 10px border radius
- [ ] Gap between avatar and content is 14px
- [ ] Messages have 20px spacing between them
- [ ] AI author name is gold colored
- [ ] AI avatar has gold background with white text
- [ ] User avatars have muted background

## Visual Result

**Before** (bulky):

```
╭─────────────────────────────────────╮  ← Unwanted container
│ [32] User · Time                    │
│      Message text...                │
╰─────────────────────────────────────╯
    ↕ no spacing
╭─────────────────────────────────────╮  ← Unwanted container
│ [32] User · Time                    │
│      Message text...                │
╰─────────────────────────────────────╯
```

**After** (clean):

```
[36] User · Time                         ← Clean, no container
     Message text...

          ↕ 20px spacing

[36] User · Time
     Message text...

          ↕ 20px spacing

█ [36] Ariadne · Time                  █  ← Only AI gets visual treatment
█      AI response...                  █
```

## Implementation Order

1. **MessageLayout component** - Fix avatar size, gaps, remove backgrounds from regular messages
2. **Avatar styling** - Fix colors for AI vs user avatars
3. **Message header** - Fix spacing and font weight
4. **Content spacing** - Remove unnecessary margins
5. **AI author name** - Add gold color
6. **Container padding** - Ensure proper padding for AI breakout in event-list.tsx

## Files to Modify

1. `apps/frontend/src/components/timeline/message-event.tsx` - Main message component
2. `apps/frontend/src/components/timeline/event-list.tsx` - Add container padding
3. `apps/frontend/src/index.css` - Verify message-item styles if any exist (check compact mode)
