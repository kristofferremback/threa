# Graph-Based Threading Wireframes - 10 Panel Navigation Approaches

Based on feedback that Reddit-style nested threading wasn't desired, these wireframes focus on **panel-based navigation** where threads are treated as **nodes in a graph**, not a tree hierarchy.

## Core Principles

1. **Graph Structure**: Messages are nodes with parent/child relationships
2. **Side Panels**: All threads open in side panels (not inline/nested)
3. **Hover Previews**: Hover over messages shows preview before opening
4. **Open Parent**: Every message can navigate to its parent
5. **No Deep Nesting**: Avoid Reddit-style visual hierarchy

---

## Option 1: Single Panel + Breadcrumbs

**Philosophy:** One thread at a time, clear navigation path

```
┌──────────────┬───────────────────────────────────────┐
│ #engineering │ Thread context:                       │
│              │ [Alice: API...] → [Bob: Error...]     │
│ Alice        │                                       │
│ API issue    │ ┌────────────────────────────────┐   │
│ 💬 5         │ │ Bob · 2:31 PM                  │   │
│              │ │ What's the error message?      │   │
│ Bob          │ │ [↑ Open parent]                │   │
│ Deploy ✓     │ └────────────────────────────────┘   │
│              │                                       │
│              │ Replies (2):                          │
│              │ ┌──────────────────────────────┐     │
│              │ │ Alice · 2:32 PM              │     │
│              │ │ Connection timeout...         │     │
│              │ │ 💬 1 →                        │     │
│              │ └──────────────────────────────┘     │
└──────────────┴───────────────────────────────────────┘
```

**Features:**
- Breadcrumb trail shows parent chain
- Click breadcrumb to navigate to any ancestor
- "Open parent" button on current message
- Single focused thread at a time

---

## Option 2: Tabbed Threads

**Philosophy:** Multiple threads open simultaneously in tabs

```
┌──────────────┬───────────────────────────────────────┐
│ #engineering │ [API issue] [Connection...] [x]       │
│              ├───────────────────────────────────────┤
│ Alice        │ Alice · 2:30 PM                       │
│ API issue    │ We need to fix the API issue          │
│ 💬 5         │ [↑ Open parent in new tab]            │
│              │                                       │
│ Bob          │ Replies (2):                          │
│ Deploy ✓     │ Bob · 2:31 PM                         │
│              │ What's the error? 💬 2 →              │
│              │                                       │
│              │ Charlie · 2:35 PM                     │
│              │ I can help 💬 1 →                     │
└──────────────┴───────────────────────────────────────┘
```

**Features:**
- Each thread opens in a new tab
- Tab shows truncated message preview
- Close tabs individually
- "Open parent in new tab" creates new tab

---

## Option 3: Stacked Panels

**Philosophy:** Horizontal panel stack, visual breadcrumb

```
┌─────────┬────────────┬────────────┬────────────┐
│ Feed    │ Thread 1   │ Thread 2   │ Thread 3   │
│         │ [×]        │ [×]        │ [×]        │
│ Alice   │ Alice      │ Bob        │ Alice      │
│ API...  │ API issue  │ Error msg? │ Timeout    │
│ 💬 5    │            │            │            │
│         │ [↑ Parent] │ [↑ Parent] │            │
│ Bob     │            │            │            │
│ Deploy  │ Replies:   │ Replies:   │ Replies:   │
│         │ Bob →      │ Alice →    │ Dave →     │
│         │ Charlie →  │ Bob →      │            │
└─────────┴────────────┴────────────┴────────────┘
```

**Features:**
- Each thread opens as new panel to the right
- Horizontal scroll to see all panels
- Visual representation of navigation depth
- Close panels individually

---

## Option 4: Graph Navigator

**Philosophy:** Visual graph representation + thread detail

```
┌──────────────┬───────────────────────────────────────┐
│ #engineering │ Thread Graph:                         │
│              │ [Alice] → [Bob] → [Alice] [Bob]       │
│ Alice        │           ↓                           │
│ API issue    │ ──────> [Charlie] → [Alice]           │
│ 💬 5         │                                       │
│              ├───────────────────────────────────────┤
│ Bob          │ Bob · 2:31 PM (selected)              │
│ Deploy ✓     │ What's the error message?             │
│              │ [↑ Open parent]                       │
│              │                                       │
│              │ Replies (2):                          │
│              │ Alice: Connection timeout... →        │
│              │ Bob: Database pool... →               │
└──────────────┴───────────────────────────────────────┘
```

**Features:**
- Mini graph shows parent → current → children
- Click nodes to navigate
- Graph updates as you navigate
- Thread detail below graph

---

## Option 5: Focus Mode

**Philosophy:** Current message + immediate connections only

```
┌──────────────┬───────────────────────────────────────┐
│ #engineering │ ↑ Parent:                             │
│              │ Alice: We need to fix...              │
│ Alice        │                                       │
│ API issue    │ • CURRENT MESSAGE                     │
│ 💬 5         │ ┌────────────────────────────────┐   │
│              │ │ Bob · 2:31 PM                  │   │
│ Bob          │ │ What's the error message?      │   │
│ Deploy ✓     │ └────────────────────────────────┘   │
│              │                                       │
│              │ ↔ Siblings (1):                       │
│              │ Charlie: I can look at pooling...     │
│              │                                       │
│              │ ↓ Replies (2):                        │
│              │ Alice: Connection timeout...          │
│              │ Bob: Database pool...                 │
└──────────────┴───────────────────────────────────────┘
```

**Features:**
- Focused current message highlighted
- Parent shown above (clickable)
- Siblings shown (other replies to same parent)
- Direct replies shown below
- Clean, uncluttered view

---

## Option 6: Timeline + Context

**Philosophy:** Chronological feed preserves temporal context

```
┌──────────────┬───────────────────────────────────────┐
│ #engineering │ Thread Context:                       │
│              │ 1. Alice: API issue                   │
│ 2:30 PM      │ 2. Bob: Error message                 │
│ Alice        │                                       │
│ API issue    │ ┌────────────────────────────────┐   │
│ 💬 5         │ │ Alice · 2:32 PM                │   │
│              │ │ Connection timeout after 30s   │   │
│ 2:45 PM      │ │ [↑ Open parent]                │   │
│ Bob          │ └────────────────────────────────┘   │
│ Deploy ✓     │                                       │
│              │ Replies (1):                          │
│              │ Dave: Check connection string...      │
└──────────────┴───────────────────────────────────────┘
```

**Features:**
- Feed shows timestamps prominently
- Context panel shows full parent chain
- Temporal awareness preserved
- Thread navigation maintains timeline context

---

## Option 7: Bidirectional Navigator

**Philosophy:** Prominent Up/Down navigation controls

```
┌──────────────┬───────────────────────────────────────┐
│ #engineering │ [↑ Up] Navigate Thread [Down ↓]      │
│              ├───────────────────────────────────────┤
│ Alice        │ ↑ Parent Message:                     │
│ API issue    │ Alice: We need to fix...              │
│ 💬 5         │                                       │
│              │ • CURRENT MESSAGE                     │
│ Bob          │ Bob · 2:31 PM                         │
│ Deploy ✓     │ What's the error message?             │
│              │                                       │
│              │ ↓ Replies (2):                        │
│              │ Alice: Connection timeout...          │
│              │ Bob: Database pool...                 │
└──────────────┴───────────────────────────────────────┘
```

**Features:**
- Large Up/Down buttons in header
- Keyboard shortcuts supported
- Parent preview shown above
- Replies preview shown below
- Easy graph traversal

---

## Option 8: Connection Map

**Philosophy:** Visual map + detail view

```
┌──────────────┬───────────────────────────────────────┐
│ #engineering │ Connection Map:                       │
│              │ [Alice] ─┬─ [Bob] ── [Alice] [Bob]   │
│ Alice        │          └─ [Charlie] ── [Alice]     │
│ API issue    │                                       │
│ 🔗 5         ├───────────────────────────────────────┤
│              │ Alice · 2:30 PM (selected)            │
│ Bob          │ We need to fix the API issue          │
│ Deploy ✓     │ [↑ Jump to parent]                    │
│              │                                       │
│              │ Direct Replies (2):                   │
│              │ Bob: Error... 🔗 2 in subthread       │
│              │ Charlie: Pooling... 🔗 1 in subthread │
└──────────────┴───────────────────────────────────────┘
```

**Features:**
- Mini-map shows full thread structure
- Click any node to jump
- Shows subthread counts
- Good for complex discussions

---

## Option 9: Thread History

**Philosophy:** Browser-style back/forward navigation

```
┌──────────────┬───────────────────────────────────────┐
│ #engineering │ [←] [→] 3 of 5 in history             │
│              │ [A] → [B] → [C] → [A] → [D]           │
│ Alice        ├───────────────────────────────────────┤
│ API issue    │ Alice · 2:32 PM (current)             │
│ 💬 5         │ Connection timeout after 30s          │
│              │ [↑ Navigate to parent]                │
│ Bob          │                                       │
│ Deploy ✓     │ Replies (1):                          │
│              │ Dave: Check connection string...      │
│              │                                       │
└──────────────┴───────────────────────────────────────┘
```

**Features:**
- Back/forward buttons like browser
- History breadcrumb shows navigation path
- Click any breadcrumb to jump
- Preserves exploration path

---

## Option 10: Multi-Context (Persistent Parent)

**Philosophy:** Parent context always visible

```
┌──────────────┬───────────────────────────────────────┐
│ #engineering │ PARENT CONTEXT (3 messages):          │
│              │ 1. Alice: API issue                   │
│ Alice        │ 2. Bob: Error message                 │
│ API issue    │ 3. Alice: Connection timeout          │
│ 💬 5         ├───────────────────────────────────────┤
│              │ ▓▓▓ CURRENT MESSAGE ▓▓▓               │
│ Bob          │ Dave · 2:37 PM                        │
│ Deploy ✓     │ Check the connection string           │
│              │ [↑ Jump to parent]                    │
│              │                                       │
│              │ REPLIES (0):                          │
│              │ No replies yet                        │
└──────────────┴───────────────────────────────────────┘
```

**Features:**
- Parent chain always visible at top
- Current message highlighted prominently
- Full context preserved
- Never lose track of conversation flow

---

## Comparison Matrix

| Option | Navigation Style | Context Visibility | Multi-Threading | Complexity |
|--------|-----------------|-------------------|-----------------|------------|
| 1. Single + Breadcrumbs | Linear | Breadcrumb | Single | Low |
| 2. Tabbed | Tab-based | Tab titles | Multiple | Low |
| 3. Stacked Panels | Spatial | Visual stack | Multiple | Medium |
| 4. Graph Navigator | Graph-based | Visual map | Single | Medium |
| 5. Focus Mode | Radial | Immediate only | Single | Low |
| 6. Timeline + Context | Temporal | Full chain | Single | Low |
| 7. Bidirectional | Up/Down | Preview | Single | Low |
| 8. Connection Map | Map-based | Full graph | Single | Medium |
| 9. Thread History | History-based | Breadcrumb | Single | Medium |
| 10. Multi-Context | Persistent | Full chain | Single | Medium |

## Key Advantages by Option

**Best for Simplicity:**
- Option 5 (Focus Mode) - Minimal, immediate connections only
- Option 7 (Bidirectional) - Simple up/down navigation

**Best for Power Users:**
- Option 2 (Tabbed) - Multiple threads, familiar pattern
- Option 3 (Stacked) - Visual spatial awareness

**Best for Context:**
- Option 10 (Multi-Context) - Parent chain always visible
- Option 6 (Timeline) - Temporal context preserved

**Best for Complex Threads:**
- Option 4 (Graph Navigator) - Visual graph representation
- Option 8 (Connection Map) - Full structure visible

**Best for Exploration:**
- Option 9 (Thread History) - Back/forward navigation
- Option 4 (Graph Navigator) - Jump anywhere

## Recommendations

**Start with these 3 for prototyping:**

1. **Option 7 (Bidirectional Navigator)** - Simple, clear, easy to understand
2. **Option 2 (Tabbed Threads)** - Familiar pattern, power user friendly
3. **Option 10 (Multi-Context)** - Never lose context, great for deep threads

All wireframes are fully implemented and interactive at http://localhost:3000
