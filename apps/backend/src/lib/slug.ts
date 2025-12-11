const MAX_SLUG_LENGTH = 50

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
}

export async function generateUniqueSlug(
  baseName: string,
  checkExists: (slug: string) => Promise<boolean>,
): Promise<string> {
  let baseSlug = generateSlug(baseName)

  // Handle empty slugs (e.g., names with only special characters)
  if (baseSlug.length === 0) {
    baseSlug = "workspace"
  }

  // Reserve space for suffix to prevent infinite loops at max length
  const maxSuffixLength = 6 // "-99999" supports up to 99999 collisions
  const maxBaseLength = MAX_SLUG_LENGTH - maxSuffixLength
  const truncatedBase = baseSlug.slice(0, maxBaseLength)

  let slug = baseSlug
  let suffix = 0

  while (await checkExists(slug)) {
    suffix++
    slug = `${truncatedBase}-${suffix}`
  }

  return slug
}
