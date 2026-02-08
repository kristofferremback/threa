import type { Request } from "express"

export function getClientIp(req: Request, fallback = ""): string {
  return req.ip || fallback
}
