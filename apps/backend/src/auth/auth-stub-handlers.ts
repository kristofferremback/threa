import type { RequestHandler } from "express"
import type { StubAuthService } from "./auth-service.stub"
import type { UserService } from "./user-service"
import type { WorkspaceService } from "../services/workspace-service"
import type { StreamService } from "../services/stream-service"
import { renderLoginPage } from "./auth-stub-login-page"
import { isSafeRedirect } from "./redirect"

interface Dependencies {
  authStubService: StubAuthService
  userService: UserService
  workspaceService: WorkspaceService
  streamService: StreamService
}

interface AuthStubHandlers {
  getLoginPage: RequestHandler
  handleLogin: RequestHandler
  handleDevLogin: RequestHandler
  handleWorkspaceJoin: RequestHandler
  handleStreamJoin: RequestHandler
}

export function createAuthStubHandlers(deps: Dependencies): AuthStubHandlers {
  const { authStubService, userService, workspaceService, streamService } = deps

  const getLoginPage: RequestHandler = (req, res) => {
    const state = (req.query.state as string) || ""
    res.send(renderLoginPage(state))
  }

  const handleLogin: RequestHandler = async (req, res) => {
    const { email, name, state } = req.body as { email?: string; name?: string; state?: string }

    const { session } = await authStubService.devLogin(userService, { email, name })

    res.cookie("wos_session", session, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    })

    const decoded = state ? Buffer.from(state, "base64").toString("utf-8") : "/"
    res.redirect(isSafeRedirect(decoded) ? decoded : "/")
  }

  const handleDevLogin: RequestHandler = async (req, res) => {
    const { email, name } = req.body as { email?: string; name?: string }

    const { user, session } = await authStubService.devLogin(userService, { email, name })

    res.cookie("wos_session", session, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    })

    res.json({ user })
  }

  const handleWorkspaceJoin: RequestHandler = async (req, res) => {
    const userId = req.userId!
    const { workspaceId } = req.params
    const { role } = req.body as { role?: "member" | "admin" }

    const member = await workspaceService.addMember(workspaceId, userId, role || "member")
    res.json({ member })
  }

  const handleStreamJoin: RequestHandler = async (req, res) => {
    const memberId = req.member!.id
    const { streamId } = req.params

    const member = await streamService.addMember(streamId, memberId)
    res.json({ member })
  }

  return {
    getLoginPage,
    handleLogin,
    handleDevLogin,
    handleWorkspaceJoin,
    handleStreamJoin,
  }
}
