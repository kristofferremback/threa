import type { Request, Response } from "express"
import { SESSION_COOKIE_CONFIG, decodeAndSanitizeRedirectState, type StubAuthService } from "@threa/backend-common"

const SESSION_COOKIE_NAME = "wos_session"

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
}

interface Dependencies {
  authStubService: StubAuthService
}

export function createAuthStubHandlers({ authStubService }: Dependencies) {
  return {
    async getLoginPage(req: Request, res: Response) {
      const state = (req.query.state as string) || ""
      res.send(`
        <html>
          <body>
            <h1>Test Auth Login (Control Plane)</h1>
            <form method="POST" action="/test-auth-login">
              <input type="hidden" name="state" value="${escapeHtml(state)}" />
              <label>Email: <input name="email" value="test@example.com" /></label><br/>
              <label>Name: <input name="name" value="Test User" /></label><br/>
              <button type="submit">Login</button>
            </form>
          </body>
        </html>
      `)
    },

    async handleLogin(req: Request, res: Response) {
      const { email, name, state } = req.body
      const result = await authStubService.devLogin({ email, name })
      res.cookie(SESSION_COOKIE_NAME, result.session, SESSION_COOKIE_CONFIG)

      if (state) {
        const redirectTo = decodeAndSanitizeRedirectState(state)
        return res.redirect(redirectTo)
      }
      res.redirect("/")
    },

    async handleDevLogin(req: Request, res: Response) {
      const { email, name } = req.body || {}
      const result = await authStubService.devLogin({ email, name })
      res.cookie(SESSION_COOKIE_NAME, result.session, SESSION_COOKIE_CONFIG)
      res.json({ user: result.user })
    },
  }
}
