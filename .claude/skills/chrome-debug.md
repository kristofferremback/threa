# Chrome DevTools MCP - Browser Debugging & Automation Skill (MacOS)

**When to use**: User asks to debug a website, test a web page, analyze performance, inspect network requests, automate browser interactions, or take screenshots of web content.

**Invocation**: `/chrome-debug` or when user mentions browser debugging, web testing, performance analysis, or screenshot tasks.

**Platform**: MacOS-optimized (uses Command key, MacOS file paths)

---

## Core Principles

### 1. Snapshot-First Approach

**ALWAYS take a snapshot before interacting with page elements.**

- Snapshots provide the accessibility tree with unique identifiers (UIDs) for all interactive elements
- Snapshots are text-based and more efficient than screenshots
- Use `take_screenshot` only for visual inspection or when user explicitly requests images

```
✅ CORRECT:
1. take_snapshot()
2. Identify element UID from snapshot
3. click(uid)

❌ WRONG:
1. take_screenshot()
2. Try to guess element selector
3. click() without UID
```

### 2. Always Use Latest Snapshot

Snapshots become stale after page changes. Retake snapshot after:

- Navigation
- Form submission
- Dynamic content load
- Any DOM modification

### 3. Element Interaction Protocol

**DOING**: Take snapshot to identify interactive elements
**EXPECT**: Snapshot contains accessibility tree with UIDs for buttons, links, inputs
**IF YES**: Extract UID and use for interaction
**IF NO**: Page may not be loaded, use wait_for or check console messages

All interaction tools require UIDs from snapshots:

- `click(uid)` - Click elements
- `fill(uid, value)` - Fill inputs
- `hover(uid)` - Hover over elements
- `drag(from_uid, to_uid)` - Drag and drop

### 4. Page Management Workflow

```
1. list_pages() - See all open tabs
2. select_page(pageId) - Switch to target page
3. take_snapshot() - Get current page state
4. Interact with page
```

**Navigation pattern**:

```
DOING: navigate_page(type: "url", url: "https://example.com")
EXPECT: Page loads successfully
IF YES: take_snapshot() to verify content
IF NO: Check console_messages for errors
```

---

## Common Workflows

### Debugging a Website

```markdown
1. **Navigate and capture state**
   - navigate_page(type: "url", url: target)
   - wait_for(text: expected_content) // If known
   - take_snapshot()

2. **Inspect for issues**
   - list_console_messages(types: ["error", "warn"])
   - get_console_message(msgid) // For details
   - list_network_requests(resourceTypes: ["xhr", "fetch"])
   - get_network_request(reqid) // For failed requests

3. **Visual inspection if needed**
   - take_screenshot() // For layout issues
   - take_screenshot(uid) // For specific element
```

### Performance Analysis

```markdown
1. **Start recording**
   - performance_start_trace(reload: true, autoStop: false)

2. **Interact with page**
   - User actions via click, fill, etc.

3. **Stop and analyze**
   - performance_stop_trace()
   - Note the insightSetId from result
   - performance_analyze_insight(insightSetId, insightName)

**Available insights**: DocumentLatency, LCPBreakdown, InteractionToNextPaint, RenderBlocking, SlowCSSSelector, CLSCulprits, Viewport
```

### Form Automation

```markdown
1. **Get form structure**
   - take_snapshot()
   - Identify form field UIDs

2. **Fill efficiently**
   - Option A: fill_form(elements: [{uid, value}, ...]) // Batch
   - Option B: fill(uid, value) for each field // Individual

3. **Submit and verify**
   - click(submit_button_uid)
   - wait_for(text: success_message)
   - take_snapshot() // Verify result
```

### Testing User Flows

```markdown
1. **Setup**
   - new_page(url) // Fresh context
   - resize_page(width, height) // If testing responsive
   - emulate(networkConditions: "Slow 3G") // If testing performance

2. **Execute flow**
   - take_snapshot() before each interaction
   - Interact with current snapshot UIDs
   - wait_for(text) between steps if needed

3. **Verify**
   - take_screenshot(filePath) // Save evidence
   - list_console_messages() // Check for errors
   - list_network_requests() // Verify API calls
```

---

## Tool Reference

### Navigation & Pages

- `list_pages()` - See all open tabs/windows
- `new_page(url)` - Open new tab
- `select_page(pageId, bringToFront: true)` - Switch context
- `close_page(pageId)` - Close tab (can't close last page)
- `navigate_page(type, url?, timeout?)` - Navigate, back, forward, reload

### Inspection & Debugging

- `take_snapshot(verbose?: false)` - **PRIMARY TOOL** - Get accessibility tree with UIDs
- `take_screenshot(uid?, fullPage?, filePath?)` - Visual capture
- `list_console_messages(types?, pageSize?, pageIdx?)` - Get logs
- `get_console_message(msgid)` - Full details including stack trace
- `list_network_requests(resourceTypes?, pageSize?)` - Get requests
- `get_network_request(reqid?)` - Request/response details

### Interaction

- `click(uid, button?, doubleClick?, modifiers?)` - Click element
  - Modifiers for MacOS: "Meta" (Command), "Alt" (Option), "Control", "Shift"
- `fill(uid, value)` - Type into input/textarea or select option
- `fill_form(elements: [{uid, value}])` - Batch fill
- `hover(uid)` - Hover over element
- `drag(from_uid, to_uid)` - Drag and drop
- `press_key(key)` - Keyboard shortcuts
  - MacOS examples: "Meta+A" (Select All), "Meta+C" (Copy), "Meta+V" (Paste)
  - Special keys: "Enter", "Escape", "ArrowDown", "Backspace", "Tab"
  - Combined: "Meta+Shift+K" (multiple modifiers)
- `upload_file(uid, filePath)` - File input (use absolute paths like `/Users/username/file.pdf`)
- `handle_dialog(action: "accept"|"dismiss", promptText?)` - Alert/confirm/prompt

### Utilities

- `wait_for(text?, textGone?, time?)` - Wait for condition
- `evaluate_script(function, args?: [{uid}])` - Run JavaScript
- `resize_page(width, height)` - Viewport size
- `emulate(networkConditions?, cpuThrottlingRate?, geolocation?)` - Simulate conditions

### Performance

- `performance_start_trace(reload: bool, autoStop: bool, filePath?)` - Begin recording
- `performance_stop_trace(filePath?)` - End recording, get insights
- `performance_analyze_insight(insightSetId, insightName)` - Deep dive into specific insight

---

## Error Handling Patterns

### When Snapshot Is Empty or Missing Elements

```
RESULT: Snapshot shows minimal content or missing expected elements
MATCHES: No
THEREFORE: Page may not be fully loaded

Actions:
1. wait_for(text: expected_key_text, timeout: 10000)
2. take_snapshot() again
3. If still missing, check list_console_messages() for JS errors
```

### When Click Doesn't Work

```
RESULT: Click executed but no visible change
MATCHES: No
THEREFORE: Element may require different interaction

Actions:
1. Check if element is actually clickable in snapshot
2. Try doubleClick: true if single click failed
3. Check console for JavaScript errors preventing action
4. Try evaluate_script() as alternative
```

### When Form Submission Fails

```
RESULT: Form filled but submission failed
MATCHES: No
THEREFORE: Validation error or JS preventing submit

Actions:
1. take_snapshot() to check for validation messages
2. list_console_messages(types: ["error", "warn"])
3. Try press_key("Enter") instead of clicking submit
4. Check network_requests for failed POST
```

### When Navigation Times Out

```
RESULT: navigate_page() times out
MATCHES: No
THEREFORE: Page load issue or infinite loading

Actions:
1. Check list_network_requests() for failed/pending requests
2. Try navigate_page(type: "reload", ignoreCache: true)
3. Check console_messages for errors
4. Verify URL is accessible
```

---

## Best Practices Summary

### ✅ DO

- Take snapshot before every interaction
- Use `wait_for()` when expecting content to appear
- List pages before selecting to avoid wrong context
- Check console messages when things fail
- Use `fill_form()` for multiple inputs (more efficient)
- Save screenshots to files for evidence (`filePath` parameter)
- Use verbose snapshots when debugging complex interactions
- Include element descriptions in tool calls for context
- Use absolute MacOS paths for files (e.g., `/Users/username/Desktop/file.png`)
- Use "Meta" for Command key in keyboard shortcuts (not "Control")

### ❌ DON'T

- Don't interact with elements without getting UID from snapshot first
- Don't reuse UIDs after page changes (snapshots are stateful)
- Don't take screenshots when snapshots would work (less efficient)
- Don't ignore console errors - they explain failures
- Don't close the last page (browser must have one open)
- Don't assume page is loaded - use `wait_for()` to confirm
- Don't use "Control" for copy/paste on MacOS - use "Meta" (Command key)

---

## Explicit Reasoning Template

Use this for each browser interaction:

```
DOING: [tool_name with params]
EXPECT: [specific outcome - e.g., "snapshot contains login button", "form submits successfully"]
IF YES: [next action - e.g., "extract button UID and click", "verify success message"]
IF NO: [debugging action - e.g., "check console for errors", "retake snapshot after waiting"]

[Execute tool]

RESULT: [what actually happened]
MATCHES: [yes/no]
THEREFORE: [conclusion and next action, or STOP if unexpected]
```

---

## Security Considerations

**CRITICAL**: The Chrome DevTools MCP exposes ALL browser content to MCP clients.

- Don't use with sensitive personal/financial sites unless user explicitly approves
- Warn user before navigating to authenticated areas
- Consider using `--isolated=true` mode for temporary profiles
- Never log or store credentials encountered in snapshots/screenshots

---

## Configuration Context (MacOS)

The server is already configured in your MCP client. Key options available:

- `--headless` - Run without visible window
- `--isolated` - Use temporary profile (auto-cleaned)
- `--viewport=WIDTHxHEIGHT` - Default window size
- `--channel=stable|beta|dev|canary` - Chrome version

**MacOS-specific notes:**

- Default Chrome installation: `/Applications/Google Chrome.app`
- Chrome Canary: `/Applications/Google Chrome Canary.app`
- User profile location: `~/Library/Application Support/Google/Chrome/`
- MCP profile cache: `~/.cache/chrome-devtools-mcp/chrome-profile-$CHANNEL`
- Screenshots/traces save to current working directory unless `filePath` specified

The browser launches automatically on first tool use (not at connection time).

---

## Common Pitfalls & Solutions

### "Element not found" errors

→ Always take fresh snapshot, don't reuse old UIDs

### "Dialog is blocking" errors

→ Use `handle_dialog()` to dismiss/accept alerts

### "Page not ready" errors

→ Use `wait_for(text: ...)` before taking snapshot

### Performance insights empty

→ Ensure `autoStop: false` and manually stop trace after interactions

### Network requests missing

→ Requests are only available since last navigation, set `includePreservedRequests: true` for history

### Screenshot is blank

→ Page may still be loading, use `wait_for()` first

---

## Example Session

```
User: "Debug why the login form on example.com isn't working"

DOING: Navigate to example.com
EXPECT: Page loads with login form visible
navigate_page(type: "url", url: "https://example.com")

DOING: Wait for page load and take snapshot
EXPECT: Snapshot shows email/password inputs and submit button
wait_for(text: "Sign In")
take_snapshot()

RESULT: Snapshot shows:
- Email input (uid: "elem_123")
- Password input (uid: "elem_456")
- Submit button (uid: "elem_789")
MATCHES: Yes
THEREFORE: Can proceed with form interaction

DOING: Fill credentials and submit
EXPECT: Form submits, page navigates or shows success/error
fill_form(elements: [
  {uid: "elem_123", value: "test@example.com"},
  {uid: "elem_456", value: "password123"}
])
click(uid: "elem_789")

DOING: Check result
EXPECT: Either success message or error visible
wait_for(time: 2) // Give time for response
take_snapshot()

RESULT: Snapshot shows error: "Invalid credentials"
MATCHES: Expected behavior (form working, just wrong creds)
THEREFORE: Form is functional, no debug needed

// If error was unexpected:
DOING: Check console for JavaScript errors
list_console_messages(types: ["error"])

DOING: Check network for failed API calls
list_network_requests(resourceTypes: ["xhr", "fetch"])
```

---

Remember: **Snapshot first, interact second, verify third.** This is the golden path.
