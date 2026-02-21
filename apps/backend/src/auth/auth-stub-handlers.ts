import type { RequestHandler } from "express"
import type { StubAuthService } from "./auth-service.stub"
import type { WorkspaceService } from "../features/workspaces"
import type { StreamService } from "../features/streams"
import type { InvitationService } from "../features/invitations"
import { renderLoginPage } from "./auth-stub-login-page"
import { decodeAndSanitizeRedirectState } from "./redirect"

interface Dependencies {
  authStubService: StubAuthService
  workspaceService: WorkspaceService
  streamService: StreamService
  invitationService: InvitationService
}

interface AuthStubHandlers {
  getLoginPage: RequestHandler
  handleLogin: RequestHandler
  handleDevLogin: RequestHandler
  handleWorkspaceJoin: RequestHandler
  handleStreamJoin: RequestHandler
}

export function createAuthStubHandlers(deps: Dependencies): AuthStubHandlers {
  const { authStubService, workspaceService, streamService, invitationService } = deps

  const getLoginPage: RequestHandler = (req, res) => {
    const state = (req.query.state as string) || ""
    res.send(renderLoginPage(state))
  }

  const handleLogin: RequestHandler = async (req, res) => {
    const { email, name, state } = req.body as { email?: string; name?: string; state?: string }

    const { user, session } = await authStubService.devLogin({ email, name })

    // Auto-accept pending invitations (mirrors real WorkOS callback flow)
    const { accepted: acceptedWorkspaceIds } = await invitationService.acceptPendingForEmail(user.email, {
      workosUserId: user.id,
      email: user.email,
      name: user.name,
    })

    res.cookie("wos_session", session, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    })

    // If user was accepted into exactly one workspace, redirect to setup
    if (acceptedWorkspaceIds.length === 1) {
      return res.redirect(`/w/${acceptedWorkspaceIds[0]}/setup`)
    }

    const redirectTo = decodeAndSanitizeRedirectState(state)
    res.redirect(redirectTo)
  }

  const handleDevLogin: RequestHandler = async (req, res) => {
    const { email, name } = req.body as { email?: string; name?: string }

    const { user, session } = await authStubService.devLogin({ email, name })

    res.cookie("wos_session", session, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    })

    res.json({ user })
  }

  const handleWorkspaceJoin: RequestHandler = async (req, res) => {
    const workosUserId = req.userId!
    const authUser = req.authUser
    const { workspaceId } = req.params
    const { role } = req.body as { role?: "member" | "admin" }

    if (!authUser) {
      return res.status(401).json({ error: "Not authenticated" })
    }

    const name = [authUser.firstName, authUser.lastName].filter(Boolean).join(" ") || authUser.email
    const user = await workspaceService.addUser(workspaceId, {
      workosUserId,
      email: authUser.email,
      name,
      role: role || "member",
    })
    res.json({ user })
  }

  const handleStreamJoin: RequestHandler = async (req, res) => {
    const userId = req.user!.id
    const workspaceId = req.workspaceId!
    const { streamId } = req.params

    const member = await streamService.addMember(streamId, userId, workspaceId, userId)
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
