import type { RequestHandler } from "express"
import type { StubAuthService } from "./auth-service.stub"
import type { UserService } from "./user-service"
import type { WorkspaceService } from "../features/workspaces"
import type { StreamService } from "../features/streams"
import type { InvitationService } from "../features/invitations"
import { renderLoginPage } from "./auth-stub-login-page"
import { decodeAndSanitizeRedirectState } from "./redirect"

interface Dependencies {
  authStubService: StubAuthService
  userService: UserService
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
  const { authStubService, userService, workspaceService, streamService, invitationService } = deps

  const getLoginPage: RequestHandler = (req, res) => {
    const state = (req.query.state as string) || ""
    res.send(renderLoginPage(state))
  }

  const handleLogin: RequestHandler = async (req, res) => {
    const { email, name, state } = req.body as { email?: string; name?: string; state?: string }

    const { user, session } = await authStubService.devLogin(userService, { email, name })

    // Auto-accept pending invitations (mirrors real WorkOS callback flow)
    const { accepted: acceptedWorkspaceIds } = await invitationService.acceptPendingForEmail(
      email || "test@example.com",
      user.id
    )

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
    const workspaceId = req.workspaceId!
    const { streamId } = req.params

    const member = await streamService.addMember(streamId, memberId, workspaceId, memberId)
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
