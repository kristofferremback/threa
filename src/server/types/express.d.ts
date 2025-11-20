import { AuthResult } from "../services/auth-service"

declare global {
  namespace Express {
    interface Request {
      user?: AuthResult["user"]
    }
  }
}

export {}
