import type { NextFunction, Request, Response } from "express"
import type { Pool } from "pg"
import { HttpError, type ApiKeyService } from "@threa/backend-common"
import type { ApiKeyScope } from "@threa/types"
import { WorkspaceRepository, UserRepository } from "../features/workspaces"
import type { UserApiKeyService, ValidatedUserApiKey } from "../features/user-api-keys"

declare global {
  namespace Express {
    interface Request {
      /** Set when authenticated via a workspace-scoped (WorkOS) API key */
      apiKey?: { id: string; name: string; permissions: Set<string> }
      /** Set when authenticated via a user-scoped API key */
      userApiKey?: ValidatedUserApiKey
    }
  }
}

interface PublicApiAuthDeps {
  apiKeyService: ApiKeyService
  userApiKeyService: UserApiKeyService
  pool: Pool
}

export function createPublicApiAuthMiddleware({ apiKeyService, userApiKeyService, pool }: PublicApiAuthDeps) {
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
        // Generic message — don't leak whether the workspace exists or the user was removed
        next(new HttpError("API key does not have access to this workspace", { status: 403, code: "FORBIDDEN" }))
        return
      }

      req.userApiKey = validated
      req.user = user
      req.workspaceId = workspaceId
      next()
      return
    }

    // Fall through to workspace-scoped (WorkOS) key validation
    const validated = await apiKeyService.validateApiKey(token)
    if (!validated) {
      next(new HttpError("Invalid API key", { status: 401, code: "UNAUTHORIZED" }))
      return
    }

    const orgId = await WorkspaceRepository.getWorkosOrganizationId(pool, workspaceId)
    if (!orgId || orgId !== validated.organizationId) {
      next(
        new HttpError("API key does not have access to this workspace", {
          status: 403,
          code: "FORBIDDEN",
        })
      )
      return
    }

    req.apiKey = {
      id: validated.id,
      name: validated.name,
      permissions: validated.permissions,
    }
    req.workspaceId = workspaceId
    next()
  }
}

export function requireApiKeyScope(...scopes: ApiKeyScope[]) {
  return function requireScope(req: Request, _res: Response, next: NextFunction): void {
    // User-scoped keys: check scopes from the key
    if (req.userApiKey) {
      for (const scope of scopes) {
        if (!req.userApiKey.scopes.has(scope)) {
          next(new HttpError(`Missing required permission: ${scope}`, { status: 403, code: "FORBIDDEN" }))
          return
        }
      }
      next()
      return
    }

    // Workspace-scoped keys
    const apiKey = req.apiKey
    if (!apiKey) {
      next(new HttpError("No API key context", { status: 401, code: "UNAUTHORIZED" }))
      return
    }

    for (const scope of scopes) {
      if (!apiKey.permissions.has(scope)) {
        next(
          new HttpError(`Missing required permission: ${scope}`, {
            status: 403,
            code: "FORBIDDEN",
          })
        )
        return
      }
    }

    next()
  }
}
