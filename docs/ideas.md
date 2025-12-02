# Configurable tabbed view

Users should be able to create presets, almost like dashboards that can be opened in a new tab or window, where several different channels are opened automatically.

---

# Implicit Thread Linking

When someone asks a question in a channel, responses might come:
1. In a proper thread (explicit relationship)
2. Directly in the channel as follow-up messages (implicit relationship)

The implicit case creates challenges for systems like memo evolution since related messages aren't structurally connected.

## Proposed Solution

Use a cheap/fast model to detect when in-channel messages are responses to earlier messages, and automatically link them.

### How it works

1. New channel message arrives
2. System evaluates if it's a response to a recent message (using embeddings + cheap LLM)
3. If detected as a reply, create a "link" record (not actual thread membership)
4. UI shows the relationship:
   - Visual connection in channel view
   - Message also appears in the linked thread (marked as auto-linked)

### Design Decisions

**Reversibility & Learning**
- Auto-links can be undone by users
- Manual links can be added by users
- Both undo and manual-add are tracked as learning signals
- System improves over time based on user corrections

**No Time Window**
- Async communication means no arbitrary cutoff
- A reply could come days later and still be detected

**Multi-question Ambiguity (Future)**
- Deferred for now
- Potential future: bundle multiple channel messages into a topic-based thread
- This needs its own design

### Benefits

- Memo evolution system stays simple (works on explicit structure only)
- Users get convenience of channel replies while maintaining thread context
- Auto-linking is visible/transparent (not hidden magic)
- Corrections improve the system over time

### Relation to Other Systems

This is separate from memo evolution. Memo evolution operates on explicit thread structure. Implicit thread linking:
- Runs on new channel messages
- Uses its own cheap model for detection
- Creates link records (not thread membership)
- Feeds its own learning loop from user corrections
