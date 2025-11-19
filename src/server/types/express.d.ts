import { AuthResult } from "../lib/auth-service"

declare global {
  namespace Express {
    interface Request {
      user?: AuthResult["user"]
    }
  }
}

export {}

