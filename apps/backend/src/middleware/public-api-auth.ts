import type { NextFunction, Request, Response } from "express"
import type { Pool } from "pg"
import { HttpError, type WorkosOrgService } from "@threa/backend-common"
import type { ApiKeyScope, WorkspacePermissionScope } from "@threa/types"
import { BOT_KEY_PREFIX } from "@threa/types"
import { UserRepository } from "../features/workspaces"
import { resolveWorkspaceAuthorization } from "./workspace-authz-resolver"
import type { UserApiKeyService, ValidatedUserApiKey } from "../features/user-api-keys"
import type { BotApiKeyService, ValidatedBotApiKey } from "../features/public-api"

declare global {
  namespace Express {
    interface Request {
      /** Set when authenticated via a user-scoped API key */
      userApiKey?: ValidatedUserApiKey
      /** Set when authenticated via a bot API key */
      botApiKey?: ValidatedBotApiKey
    }
  }
}

interface PublicApiAuthDeps {
  userApiKeyService: UserApiKeyService
  botApiKeyService: BotApiKeyService
  pool: Pool
  workosOrgService: WorkosOrgService
}

export function createPublicApiAuthMiddleware({
  userApiKeyService,
  botApiKeyService,
  pool,
  workosOrgService,
}: PublicApiAuthDeps) {
  return async function publicApiAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      next(new HttpError("Missing or invalid Authorization header", { status: 401, code: "UNAUTHORIZED" }))
      return
    }

    const token = authHeader.slice(7)
    const workspaceId = req.params.workspaceId
    if (!workspaceId) {
      next(new HttpError("Missing workspaceId", { status: 400, code: "BAD_REQUEST" }))
      return
    }

    // Try user-scoped key first (fast prefix check)
    if (token.startsWith("threa_uk_")) {
      const validated = await userApiKeyService.validateKey(token)
      if (!validated) {
        next(new HttpError("Invalid API key", { status: 401, code: "UNAUTHORIZED" }))
        return
      }

      if (validated.workspaceId !== workspaceId) {
        next(new HttpError("API key does not have access to this workspace", { status: 403, code: "FORBIDDEN" }))
        return
      }

      // Resolve workspace user for stream access checks
      const user = await UserRepository.findById(pool, workspaceId, validated.userId)
      if (!user) {
        next(new HttpError("API key does not have access to this workspace", { status: 403, code: "FORBIDDEN" }))
        return
      }

      req.userApiKey = validated
      const authz = await resolveWorkspaceAuthorization({
        pool,
        workosOrgService,
        workspaceId,
        workosUserId: user.workosUserId,
        userId: user.id,
        source: "user_api_key",
        scopeFilter: (permission) => validated.scopes.has(permission),
      })
      if (authz.status === "missing_org") {
        next(
          new HttpError("Workspace is not configured for WorkOS authorization", {
            status: 500,
            code: "WORKSPACE_AUTHORIZATION_NOT_CONFIGURED",
          })
        )
        return
      }
      if (authz.status === "missing_membership") {
        next(new HttpError("API key does not have access to this workspace", { status: 403, code: "FORBIDDEN" }))
        return
      }

      if (user.role !== authz.value.compatibilityRole) {
        await UserRepository.update(pool, workspaceId, user.id, { role: authz.value.compatibilityRole })
      }

      req.authz = authz.value
      req.user = {
        ...user,
        role: authz.value.compatibilityRole,
        isOwner: authz.value.isOwner,
        assignedRole: authz.value.assignedRoles[0] ?? null,
        assignedRoles: authz.value.assignedRoles,
        canEditRole: authz.value.canEditRole,
      }
      req.workspaceId = workspaceId
      next()
      return
    }

    // Try bot-scoped key (fast prefix check)
    if (token.startsWith(BOT_KEY_PREFIX)) {
      const validated = await botApiKeyService.validateKey(token)
      if (!validated) {
        next(new HttpError("Invalid API key", { status: 401, code: "UNAUTHORIZED" }))
        return
      }

      if (validated.workspaceId !== workspaceId) {
        next(new HttpError("API key does not have access to this workspace", { status: 403, code: "FORBIDDEN" }))
        return
      }

      req.botApiKey = validated
      req.authz = {
        source: "bot_api_key",
        organizationId: null,
        organizationMembershipId: null,
        permissions: new Set(validated.scopes as Iterable<WorkspacePermissionScope>),
        assignedRoles: [],
        canEditRole: false,
      }
      req.workspaceId = workspaceId
      next()
      return
    }

    // No recognized key prefix
    next(new HttpError("Invalid API key", { status: 401, code: "UNAUTHORIZED" }))
  }
}

export function requireApiKeyScope(...scopes: ApiKeyScope[]) {
  return function requireScope(req: Request, _res: Response, next: NextFunction): void {
    if (!req.userApiKey && !req.botApiKey) {
      next(new HttpError("No API key context", { status: 401, code: "UNAUTHORIZED" }))
      return
    }

    for (const scope of scopes) {
      if (!req.authz?.permissions.has(scope)) {
        next(new HttpError(`Missing required permission: ${scope}`, { status: 404, code: "NOT_FOUND" }))
        return
      }
    }

    next()
  }
}
