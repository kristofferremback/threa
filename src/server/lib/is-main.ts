import { fileURLToPath } from "node:url"

export function esMain(importMetaUrl: string): boolean {
  return fileURLToPath(importMetaUrl) === process.argv[1]
}
