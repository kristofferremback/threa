function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
}

/**
 * HTML template for the stub auth login page.
 * Only used in development when USE_STUB_AUTH=true.
 */
export function renderLoginPage(state: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Login - Threa</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #fafafa; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { background: #171717; border: 1px solid #262626; border-radius: 12px; padding: 32px; width: 100%; max-width: 400px; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .subtitle { color: #a3a3a3; margin-bottom: 24px; }
    .preset-buttons { display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px; }
    .preset-btn { background: #262626; border: 1px solid #404040; color: #fafafa; padding: 12px 16px; border-radius: 8px; cursor: pointer; text-align: left; transition: background 0.15s; }
    .preset-btn:hover { background: #303030; }
    .preset-btn .name { font-weight: 500; }
    .preset-btn .email { color: #a3a3a3; font-size: 14px; }
    .divider { display: flex; align-items: center; gap: 16px; margin: 24px 0; color: #525252; font-size: 14px; }
    .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: #404040; }
    .preset-buttons form { display: contents; }
    .custom-form { display: flex; flex-direction: column; gap: 16px; }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; color: #a3a3a3; }
    input { background: #262626; border: 1px solid #404040; color: #fafafa; padding: 10px 12px; border-radius: 6px; font-size: 16px; }
    input:focus { outline: none; border-color: #c9a227; }
    button[type="submit"] { background: #c9a227; color: #0a0a0a; border: none; padding: 12px 16px; border-radius: 8px; font-size: 16px; font-weight: 500; cursor: pointer; transition: background 0.15s; }
    button[type="submit"]:hover { background: #d4af37; }
    .warning { background: #422006; border: 1px solid #713f12; color: #fcd34d; padding: 12px; border-radius: 8px; font-size: 14px; margin-bottom: 24px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Test Login</h1>
    <p class="subtitle">Development authentication</p>
    <div class="warning">⚠️ Stub auth enabled. This page only appears in development.</div>
    <div class="preset-buttons">
      <form method="POST" action="/test-auth-login">
        <input type="hidden" name="state" value="${escapeHtml(state)}" />
        <input type="hidden" name="email" value="alice@example.com" />
        <input type="hidden" name="name" value="Alice Anderson" />
        <button type="submit" class="preset-btn">
          <div class="name">Alice Anderson</div>
          <div class="email">alice@example.com</div>
        </button>
      </form>
      <form method="POST" action="/test-auth-login">
        <input type="hidden" name="state" value="${escapeHtml(state)}" />
        <input type="hidden" name="email" value="bob@example.com" />
        <input type="hidden" name="name" value="Bob Builder" />
        <button type="submit" class="preset-btn">
          <div class="name">Bob Builder</div>
          <div class="email">bob@example.com</div>
        </button>
      </form>
    </div>
    <div class="divider">or enter custom credentials</div>
    <form method="POST" action="/test-auth-login" class="custom-form">
      <input type="hidden" name="state" value="${escapeHtml(state)}" />
      <label>
        Email
        <input type="email" name="email" value="test@example.com" required />
      </label>
      <label>
        Name
        <input type="text" name="name" value="Test User" required />
      </label>
      <button type="submit">Sign In</button>
    </form>
  </div>
</body>
</html>`
}
