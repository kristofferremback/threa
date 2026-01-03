import type { RequestHandler } from "express"
import type { StubAuthService } from "../services/auth-service.stub"
import type { UserService } from "../services/user-service"
import type { WorkspaceService } from "../services/workspace-service"
import type { StreamService } from "../services/stream-service"
import { renderLoginPage } from "./auth-stub-login-page"

interface Dependencies {
  authStubService: StubAuthService
  userService: UserService
  workspaceService: WorkspaceService
  streamService: StreamService
}

export function createAuthStubHandlers(deps: Dependencies) {
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

    const redirectTo = state ? Buffer.from(state, "base64").toString("utf-8") : "/"
    res.redirect(redirectTo)
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
    const userId = req.userId!
    const { streamId } = req.params

    const member = await streamService.addMember(streamId, userId)
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
