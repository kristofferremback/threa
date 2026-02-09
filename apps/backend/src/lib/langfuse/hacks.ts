/**
 * Explicit hacks for local development environment issues.
 * These work around infrastructure problems that can't be cleanly solved otherwise.
 */

import { logger } from "../logger"

/**
 * Override global fetch to rewrite Langfuse MinIO URLs.
 *
 * When self-hosting Langfuse with MinIO in Docker, presigned URLs contain
 * the internal Docker hostname (langfuse-minio:9000) which the host can't resolve.
 * This rewrites those URLs to localhost with the external port mapping.
 *
 * Enabled via LANGFUSE_REWRITE_MINIO_HOST=from:port,to:port (e.g., "langfuse-minio:9000,localhost:9190")
 */
export function overrideFetchForLangfuseMinio(): void {
  const rewriteConfig = process.env.LANGFUSE_REWRITE_MINIO_HOST
  if (!rewriteConfig) return

  const [from, to] = rewriteConfig.split(",")
  if (!from || !to) {
    logger.warn({ rewriteConfig }, "Invalid LANGFUSE_REWRITE_MINIO_HOST format, expected 'from:port,to:port'")
    return
  }

  const originalFetch = globalThis.fetch
  const rewrite = (url: string) => url.replace(from, to)

  const patchedFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    switch (true) {
      case typeof input === "string" && input.includes(from):
        return originalFetch(rewrite(input), init)
      case input instanceof URL && input.href.includes(from):
        return originalFetch(new URL(rewrite(input.href)), init)
      case input instanceof Request && input.url.includes(from):
        return originalFetch(new Request(rewrite(input.url), input), init)
      default:
        return originalFetch(input, init)
    }
  }

  // Preserve Bun-specific properties on fetch
  Object.assign(patchedFetch, originalFetch)
  globalThis.fetch = patchedFetch as typeof fetch

  logger.info({ from, to }, "Langfuse MinIO URL rewriting enabled")
}
