import type { NextFunction, Request, Response } from "express"
import type { Pool } from "pg"
import { HttpError, type ApiKeyService } from "@threa/backend-common"
import type { ApiKeyScope } from "@threa/types"
import { WorkspaceRepository } from "../features/workspaces"

declare global {
  namespace Express {
    interface Request {
      apiKey?: { id: string; name: string; permissions: Set<string> }
    }
  }
}

interface PublicApiAuthDeps {
  apiKeyService: ApiKeyService
  pool: Pool
}

export function createPublicApiAuthMiddleware({ apiKeyService, pool }: PublicApiAuthDeps) {
  return async function publicApiAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      next(new HttpError("Missing or invalid Authorization header", { status: 401, code: "UNAUTHORIZED" }))
      return
    }

    const token = authHeader.slice(7)
    const validated = await apiKeyService.validateApiKey(token)
    if (!validated) {
      next(new HttpError("Invalid API key", { status: 401, code: "UNAUTHORIZED" }))
      return
    }

    const workspaceId = req.params.workspaceId
    if (!workspaceId) {
      next(new HttpError("Missing workspaceId", { status: 400, code: "BAD_REQUEST" }))
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
