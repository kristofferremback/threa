import type { NextFunction, Request, Response } from "express"
import ipaddr from "ipaddr.js"
import { getClientIp } from "../lib/client-ip"

export function isInternalNetworkIp(rawIp: string): boolean {
  if (!rawIp) return false

  // Normalize IPv4-mapped IPv6 addresses like ::ffff:127.0.0.1
  const normalized = rawIp.replace(/^::ffff:/, "")

  if (!ipaddr.isValid(normalized)) return false

  const parsed = ipaddr.parse(normalized)
  const range = parsed.range()
  return (
    range === "loopback" ||
    range === "private" ||
    range === "linkLocal" ||
    range === "uniqueLocal" ||
    range === "carrierGradeNat"
  )
}

export function createOpsAccessMiddleware() {
  return function opsAccessMiddleware(req: Request, res: Response, next: NextFunction): void {
    const clientIp = getClientIp(req)
    if (isInternalNetworkIp(clientIp)) {
      return next()
    }

    res.status(403).json({ error: "Ops endpoint is restricted" })
  }
}
