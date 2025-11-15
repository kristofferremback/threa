# Threading Model Wireframes - 10 Unique Approaches

Based on the spec requirements:
- Unlimited threading depth
- Flat messages + threaded conversations
- Original message stays in feed
- Clear visual hierarchy
- Multi-channel conversations visible

---

## Option 1: Inline Collapse with Depth Indicators

**Philosophy:** Show thread depth inline with progressive disclosure

```
#engineering
┌─────────────────────────────────────────────────────────┐
│ Alice · 2:30 PM                                         │
│ We need to fix the API issue                           │
│ [💬 3 replies]                                          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Bob · 2:45 PM                                           │
│ Great deploy today                                      │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Alice · 2:30 PM                                    [−]  │
│ We need to fix the API issue                           │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ • Bob · 2:31 PM                               [+]  │ │
│ │   What's the error message?                        │ │
│ │   [2 replies]                                       │ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ • Charlie · 2:35 PM                                │ │
│ │   I can look at connection pooling                 │ │
│ │   ┌─────────────────────────────────────────────┐  │ │
│ │   │ ◦ Alice · 2:36 PM                           │  │ │
│ │   │   Thanks, here's the logs                   │  │ │
│ │   └─────────────────────────────────────────────┘  │ │
│ └─────────────────────────────────────────────────────┘ │
│ [Reply]                                                 │
└─────────────────────────────────────────────────────────┘
```

**UX Features:**
- Click message to expand/collapse thread
- Depth shown via bullets (•, ◦, ▪) and indentation
- Collapsed state shows reply count
- All content stays in main feed

---

## Option 2: Side-by-Side Split Panel

**Philosophy:** Main feed + dedicated thread viewer

```
┌──────────────────────┬──────────────────────────────────┐
│ #engineering         │ Thread: "API issue"              │
│                      │ #engineering  #api  #security    │
├──────────────────────┼──────────────────────────────────┤
│ Alice · 2:30 PM      │ Alice · 2:30 PM                  │
│ We need to fix the   │ We need to fix the API issue     │
│ API issue            │                                  │
│ [View thread →]      │ ├─ Bob · 2:31 PM                 │
│                      │ │  What's the error message?     │
│ Bob · 2:45 PM        │ │                                │
│ Great deploy today   │ │  ├─ Alice · 2:32 PM            │
│                      │ │  │  Connection timeout after   │
│ Charlie · 3:00 PM    │ │  │  30s                        │
│ Lunch? 🍕            │ │  │                             │
│                      │ │  └─ Bob · 2:33 PM              │
│                      │ │     That's the database pool   │
│                      │ │                                │
│                      │ └─ Charlie · 2:35 PM             │
│                      │    I can look at connection      │
│                      │    pooling                       │
│                      │                                  │
│                      │    └─ Alice · 2:36 PM            │
│                      │       Thanks, here's the logs    │
│                      │                                  │
│                      │ [Type your reply...]             │
└──────────────────────┴──────────────────────────────────┘
```

**UX Features:**
- Click "View thread" opens right panel
- Left side always shows flat feed
- Right side shows full thread structure
- Can have multiple threads open in tabs

---

## Option 3: Hover-Reveal Context

**Philosophy:** Minimal by default, rich on interaction

```
#engineering
─────────────────────────────────────────────────────────
  Alice · 2:30 PM · 💬 3
  We need to fix the API issue
─────────────────────────────────────────────────────────
  Bob · 2:45 PM
  Great deploy today
─────────────────────────────────────────────────────────

[HOVER STATE:]
─────────────────────────────────────────────────────────
┌ Alice · 2:30 PM · 💬 3                                ┐
│ We need to fix the API issue                          │
│                                                        │
│ └─ Bob: What's the error message? (2 more)            │
│ └─ Charlie: I can look at connection pooling (1 more) │
│                                                        │
│ [View full thread] [Reply]                            │
└────────────────────────────────────────────────────────┘
─────────────────────────────────────────────────────────
  Bob · 2:45 PM
  Great deploy today
─────────────────────────────────────────────────────────
```

**UX Features:**
- Hover shows preview of top-level replies
- "(X more)" indicates nested conversations
- Click "View full thread" for complete view
- Keeps feed clean and scannable

---

## Option 4: Conversation Cards with Expandable Branches

**Philosophy:** Each conversation is a discrete card

```
#engineering

┌─────────────────────────────────────────────────────────┐
│ 💬 Conversation · Started by Alice · 2:30 PM            │
│ #engineering  #api  #security                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Alice · 2:30 PM                                         │
│ We need to fix the API issue                           │
│                                                         │
│   Bob · 2:31 PM ────────────┐                          │
│   What's the error message?  │                         │
│                             │ [Expand branch +]        │
│                                                         │
│   Charlie · 2:35 PM ─────────────────┐                 │
│   I can look at connection pooling    │                │
│                                      │ [Expand +]      │
│                                                         │
│ [+ Reply to conversation]                               │
└─────────────────────────────────────────────────────────┘

──────────────────────────────────────────────────────────

Bob · 2:45 PM
Great deploy today

──────────────────────────────────────────────────────────

[EXPANDED BRANCH:]
┌─────────────────────────────────────────────────────────┐
│   Bob · 2:31 PM ────────────┐                          │
│   What's the error message?  │ [Collapse −]            │
│                                                         │
│     Alice · 2:32 PM                                     │
│     Connection timeout after 30s                        │
│                                                         │
│     Bob · 2:33 PM                                       │
│     That's the database pool                            │
│                                                         │
│   [+ Reply in this branch]                              │
└─────────────────────────────────────────────────────────┘
```

**UX Features:**
- Branches collapse independently
- Visual flow lines show relationships
- Can expand/collapse specific branches
- Conversations are visually separated from flat messages

---

## Option 5: Timeline with Thread Jumps

**Philosophy:** Chronological feed with thread navigation

```
#engineering

2:30 PM ─────────────────────────────────────────────────
         Alice
         We need to fix the API issue
         → Started conversation (5 messages) [Jump to thread ↗]

2:45 PM ─────────────────────────────────────────────────
         Bob
         Great deploy today

3:00 PM ─────────────────────────────────────────────────
         Charlie
         Anyone free for lunch?

[THREAD VIEW - Modal or Overlay:]
╔═════════════════════════════════════════════════════════╗
║ Thread: API issue                              [Close ×]║
║ #engineering  #api  #security                           ║
╠═════════════════════════════════════════════════════════╣
║                                                         ║
║ 2:30 PM Alice                                           ║
║ We need to fix the API issue                           ║
║                                                         ║
║   2:31 PM Bob                                           ║
║   What's the error message?                             ║
║                                                         ║
║     2:32 PM Alice                                       ║
║     Connection timeout after 30s                        ║
║                                                         ║
║     2:33 PM Bob                                         ║
║     That's the database pool                            ║
║                                                         ║
║   2:35 PM Charlie                                       ║
║   I can look at connection pooling                      ║
║                                                         ║
║     2:36 PM Alice                                       ║
║     Thanks, here's the logs                             ║
║                                                         ║
║ [Type your reply...]                                    ║
╚═════════════════════════════════════════════════════════╝
```

**UX Features:**
- Main feed stays purely chronological
- Threads open in overlay/modal
- Thread summary in feed with jump link
- Time-focused navigation

---

## Option 6: Indented Tree with Visual Connectors

**Philosophy:** Classic tree view with modern polish

```
#engineering

Alice · 2:30 PM                                    #api #security
We need to fix the API issue
│
├─● Bob · 2:31 PM
│   What's the error message?
│   │
│   ├─● Alice · 2:32 PM
│   │   Connection timeout after 30s
│   │
│   └─● Bob · 2:33 PM
│       That's the database pool
│
└─● Charlie · 2:35 PM
    I can look at connection pooling
    │
    └─● Alice · 2:36 PM
        Thanks, here's the logs
        [Reply]

─────────────────────────────────────────────────────────

Bob · 2:45 PM
Great deploy today

─────────────────────────────────────────────────────────

Charlie · 3:00 PM
Anyone free for lunch?
```

**UX Features:**
- Tree connectors show parent-child relationships
- Dots (●) mark reply points
- Channel tags shown on root message
- Clear visual hierarchy
- Reply buttons appear on hover

---

## Option 7: Stacked Cards with Depth Shadows

**Philosophy:** Physical depth through visual layering

```
#engineering

┌─────────────────────────────────────────────────────────┐
│ Alice · 2:30 PM                    #engineering #api    │
│ We need to fix the API issue                           │
│                                                         │
│ ┌───────────────────────────────────────────────────┐  │
│ │ Bob · 2:31 PM                                     │  │
│ │ What's the error message?                         │  │
│ │                                                   │  │
│ │ ┌─────────────────────────────────────────────┐  │  │
│ │ │ Alice · 2:32 PM                             │  │  │
│ │ │ Connection timeout after 30s                │  │  │
│ │ └─────────────────────────────────────────────┘  │  │
│ │ ┌─────────────────────────────────────────────┐  │  │
│ │ │ Bob · 2:33 PM                               │  │  │
│ │ │ That's the database pool                    │  │  │
│ │ └─────────────────────────────────────────────┘  │  │
│ └───────────────────────────────────────────────────┘  │
│ ┌───────────────────────────────────────────────────┐  │
│ │ Charlie · 2:35 PM                                 │  │
│ │ I can look at connection pooling                  │  │
│ │                                                   │  │
│ │ ┌─────────────────────────────────────────────┐  │  │
│ │ │ Alice · 2:36 PM                             │  │  │
│ │ │ Thanks, here's the logs                     │  │  │
│ │ └─────────────────────────────────────────────┘  │  │
│ └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘

Bob · 2:45 PM
Great deploy today
```

**UX Features:**
- Nested cards create visual depth
- Shadow/border weight increases with depth
- Replies contained within parent context
- Clear boundaries between conversation levels

---

## Option 8: Compact Thread Links with Modal Expansion

**Philosophy:** Aggressive compression for high-density feeds

```
#engineering

Alice · 2:30 PM · #engineering #api #security
We need to fix the API issue
├ Bob, Alice, Bob → Charlie, Alice [View 5 replies]

Bob · 2:45 PM
Great deploy today

Charlie · 3:00 PM
Anyone free for lunch?

[CLICK "View 5 replies":]
╔═════════════════════════════════════════════════════════╗
║ 💬 Thread from Alice's message                          ║
║ "We need to fix the API issue"                          ║
╠═════════════════════════════════════════════════════════╣
║                                                         ║
║ 1. Bob · 2:31 PM                                        ║
║    What's the error message?                            ║
║    ↓                                                    ║
║    2. Alice · 2:32 PM                                   ║
║       Connection timeout after 30s                      ║
║    ↓                                                    ║
║    3. Bob · 2:33 PM                                     ║
║       That's the database pool                          ║
║                                                         ║
║ 4. Charlie · 2:35 PM                                    ║
║    I can look at connection pooling                     ║
║    ↓                                                    ║
║    5. Alice · 2:36 PM                                   ║
║       Thanks, here's the logs                           ║
║                                                         ║
║ [Type reply...]                                         ║
╚═════════════════════════════════════════════════════════╝
```

**UX Features:**
- Feed shows only participant names
- Click to expand full thread
- Numbered steps show conversation flow
- Arrows (↓) indicate direct replies
- Minimal visual noise in main feed

---

## Option 9: Slack-Style with Enhanced Thread Panel

**Philosophy:** Familiar Slack model with improvements

```
┌─────────────────────────────────────┬───────────────────┐
│ #engineering                        │ 💬 Thread         │
│                                     │                   │
│ Alice · 2:30 PM                     │ Alice · 2:30 PM   │
│ We need to fix the API issue        │ We need to fix... │
│ 💬 5 replies  Last: 2:36 PM  [→]    │ #eng #api #sec    │
│                                     │                   │
│ Bob · 2:45 PM                       │ 5 replies         │
│ Great deploy today                  │ ───────────────   │
│                                     │                   │
│ Charlie · 3:00 PM                   │ Bob · 2:31 PM     │
│ Anyone free for lunch?              │ What's the error  │
│                                     │ message?          │
│                                     │   └ Alice         │
│                                     │   └ Bob           │
│                                     │                   │
│                                     │ Charlie · 2:35 PM │
│                                     │ I can look at...  │
│                                     │   └ Alice         │
│                                     │                   │
│                                     │ [Reply...]        │
└─────────────────────────────────────┴───────────────────┘
```

**UX Features:**
- Right panel shows thread detail
- Main feed shows thread summary
- Nested replies shown with tree preview
- "Last reply" timestamp for recency
- Click anywhere on message to open thread

---

## Option 10: Conversation-First with Flat Messages as Interruptions

**Philosophy:** Invert the model - conversations are primary

```
#engineering

╭─ CONVERSATION ─────────────────────────────────────────╮
│ 🔗 #engineering  #api  #security                       │
│                                                        │
│ Alice · 2:30 PM                                        │
│ We need to fix the API issue                          │
│                                                        │
│ ┌─ Thread 1 ──────────────────────────────────────┐   │
│ │ Bob · 2:31 PM                                   │   │
│ │ What's the error message?                       │   │
│ │   Alice: Connection timeout after 30s           │   │
│ │   Bob: That's the database pool                 │   │
│ │ [+2 more in thread]                              │   │
│ └──────────────────────────────────────────────────┘   │
│                                                        │
│ ┌─ Thread 2 ──────────────────────────────────────┐   │
│ │ Charlie · 2:35 PM                               │   │
│ │ I can look at connection pooling                │   │
│ │   Alice: Thanks, here's the logs                │   │
│ └──────────────────────────────────────────────────┘   │
│                                                        │
│ [+ Reply to conversation]                              │
╰────────────────────────────────────────────────────────╯

───────────────────────────────────────────────────────────
  Bob · 2:45 PM
  Great deploy today
───────────────────────────────────────────────────────────

╭─ CONVERSATION ─────────────────────────────────────────╮
│ 🔗 #engineering                                        │
│                                                        │
│ Charlie · 3:00 PM                                      │
│ Anyone free for lunch?                                 │
│                                                        │
│ [+ Start thread]                                       │
╰────────────────────────────────────────────────────────╯
```

**UX Features:**
- Conversations get card treatment
- Flat messages shown as simple dividers
- Threads grouped within conversation
- Multi-channel tags prominent
- Expandable thread previews
- Reply goes to conversation, not specific message

---

## Comparison Matrix

| Option | Scanability | Depth Clarity | Space Efficiency | Interaction Complexity |
|--------|-------------|---------------|------------------|------------------------|
| 1. Inline Collapse | Medium | High | Medium | Low |
| 2. Split Panel | High | High | Low | Medium |
| 3. Hover Reveal | High | Medium | High | Medium |
| 4. Conversation Cards | Medium | Medium | Low | Medium |
| 5. Timeline Jump | High | Low | High | High |
| 6. Indented Tree | Medium | High | Medium | Low |
| 7. Stacked Cards | Low | High | Low | Low |
| 8. Compact Links | High | Low | High | Medium |
| 9. Slack Enhanced | High | Medium | Medium | Low |
| 10. Conversation-First | Medium | Medium | Medium | Medium |

## Recommendations for Prototyping

**Test First:**
1. **Option 3 (Hover Reveal)** - Best balance of clean feed + depth visibility
2. **Option 1 (Inline Collapse)** - Most flexible for unlimited depth
3. **Option 9 (Slack Enhanced)** - Familiar but improved

**Consider Later:**
4. Option 6 (Tree) - If users want always-visible structure
5. Option 2 (Split Panel) - For power users with large screens

**Likely Skip:**
- Option 5 (Timeline) - Too much modal/overlay friction
- Option 7 (Stacked) - Poor space efficiency
- Option 8 (Compact) - Hides too much context
