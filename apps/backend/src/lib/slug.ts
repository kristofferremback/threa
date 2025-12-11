export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50)
}

export async function generateUniqueSlug(
  baseName: string,
  checkExists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const baseSlug = generateSlug(baseName)
  let slug = baseSlug
  let suffix = 0

  while (await checkExists(slug)) {
    suffix++
    slug = `${baseSlug}-${suffix}`.slice(0, 50)
  }

  return slug
}
