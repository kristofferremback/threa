/** Only allow relative paths — blocks protocol-relative URLs (//evil.com) and absolute URLs. */
export function isSafeRedirect(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//")
}
