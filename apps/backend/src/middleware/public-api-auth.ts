import type { NextFunction, Request, Response } from "express"
import type { Pool } from "pg"
import { HttpError } from "@threa/backend-common"
import type { ApiKeyScope } from "@threa/types"
import { BOT_KEY_PREFIX } from "@threa/types"
import { UserRepository } from "../features/workspaces"
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
}

export function createPublicApiAuthMiddleware({ userApiKeyService, botApiKeyService, pool }: PublicApiAuthDeps) {
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
      req.user = user
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
    // User-scoped keys: check scopes from the key
    if (req.userApiKey) {
      for (const scope of scopes) {
        if (!req.userApiKey.scopes.has(scope)) {
          next(new HttpError(`Missing required permission: ${scope}`, { status: 404, code: "NOT_FOUND" }))
          return
        }
      }
      next()
      return
    }

    // Bot-scoped keys: check scopes from the key
    if (req.botApiKey) {
      for (const scope of scopes) {
        if (!req.botApiKey.scopes.has(scope)) {
          next(new HttpError(`Missing required permission: ${scope}`, { status: 404, code: "NOT_FOUND" }))
          return
        }
      }
      next()
      return
    }

    next(new HttpError("No API key context", { status: 401, code: "UNAUTHORIZED" }))
  }
}
