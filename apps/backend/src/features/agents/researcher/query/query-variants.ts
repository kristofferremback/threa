export function buildQueryVariants(message: string): string[] {
  const trimmed = message.trim()
  if (!trimmed) {
    return []
  }

  const variants: string[] = [trimmed]
  const seen = new Set([trimmed.toLowerCase()])
  const tokens = trimmed.match(/[\p{L}\p{N}]+/gu) ?? []
  const significantTokens = tokens.filter((token) => token.length >= 4)

  const candidateVariants: string[] = []
  if (significantTokens.length >= 2) {
    candidateVariants.push(significantTokens.slice(-2).join(" "))
    candidateVariants.push(significantTokens.slice(0, 2).join(" "))
    candidateVariants.push(significantTokens.slice(0, 6).join(" "))
    candidateVariants.push(significantTokens.slice(-6).join(" "))
  }
  if (tokens.length >= 2) {
    candidateVariants.push(tokens.slice(-4).join(" "))
  }

  for (const candidate of candidateVariants) {
    const normalized = candidate.trim()
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    variants.push(normalized)
  }

  return variants
}
