# Scroll Behavior Refinement

## Problem Statement

Current scroll behavior auto-scrolls to the bottom on new messages, which is problematic:

1. Should NOT auto-scroll if user is not already at the bottom (annoying in active channels)
2. Opening a stream should show earliest unread message (centered), not bottom
3. New streams should start at bottom
4. New messages should "push up" existing messages, not smooth scroll

## Requirements

### When opening a stream (existing member)
- Find the earliest unread message
- Center it in the viewport
- Show unread divider if applicable

### When opening a stream (just joined)
- Start at the bottom
- No unread handling needed

### When new message arrives (user at bottom)
- Show new message immediately
- New message should appear to "push up" old messages
- No smooth scroll animation

### When new message arrives (user NOT at bottom)
- Do NOT scroll
- Optionally show "New messages" indicator

## Implementation Approach

### 1. Track scroll position
```typescript
const [isAtBottom, setIsAtBottom] = useState(true)

const handleScroll = (e) => {
  const { scrollHeight, scrollTop, clientHeight } = e.target
  const threshold = 100 // pixels from bottom
  setIsAtBottom(scrollHeight - scrollTop - clientHeight < threshold)
}
```

### 2. Conditional scroll on new messages
```typescript
useEffect(() => {
  if (isAtBottom && newMessage) {
    scrollToBottom({ behavior: 'instant' }) // Not 'smooth'
  }
}, [events, isAtBottom])
```

### 3. Unread message positioning
```typescript
// On initial load for existing members
const firstUnreadRef = useRef<HTMLDivElement>(null)

useEffect(() => {
  if (firstUnreadRef.current && membership.lastReadSequence) {
    firstUnreadRef.current.scrollIntoView({ block: 'center' })
  }
}, [])
```

## Files to Modify

- `apps/frontend/src/components/timeline/timeline-view.tsx` - Main scroll logic
- `apps/frontend/src/hooks/use-streams.ts` - Track membership and lastReadSequence

## Acceptance Criteria

- [ ] Existing members see earliest unread message centered on open
- [ ] New members start at bottom
- [ ] Auto-scroll only when user is already at bottom
- [ ] New messages appear instantly (no smooth scroll)
- [ ] "New messages" indicator when not at bottom (optional)
