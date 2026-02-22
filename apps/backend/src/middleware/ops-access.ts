import type { NextFunction, Request, Response } from "express"
import ipaddr from "ipaddr.js"

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
    // Use the actual TCP peer address, not req.ip which trusts X-Forwarded-For
    // via trust proxy. Ops endpoints are accessed directly by infrastructure,
    // never through the workspace router proxy.
    const peerIp = req.socket.remoteAddress ?? ""
    if (isInternalNetworkIp(peerIp)) {
      return next()
    }

    res.status(403).json({ error: "Ops endpoint is restricted" })
  }
}
