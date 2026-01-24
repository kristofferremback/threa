/**
 * Config file loader for evaluation runs.
 *
 * Loads and validates YAML config files that specify
 * detailed evaluation run configurations.
 */

import { readFileSync } from "fs"
import { parse as parseYaml } from "yaml"
import { evalConfigFileSchema, type EvalConfigFile } from "./config-types"

/**
 * Load and validate an evaluation config file.
 *
 * @param filePath - Path to the YAML config file
 * @returns Validated config file contents
 * @throws Error if file doesn't exist or validation fails
 */
export function loadConfigFile(filePath: string): EvalConfigFile {
  // Read file
  let content: string
  try {
    content = readFileSync(filePath, "utf-8")
  } catch (error) {
    throw new Error(
      `Failed to read config file: ${filePath}\n${error instanceof Error ? error.message : String(error)}`
    )
  }

  // Parse YAML
  let parsed: unknown
  try {
    parsed = parseYaml(content)
  } catch (error) {
    throw new Error(
      `Failed to parse YAML in config file: ${filePath}\n${error instanceof Error ? error.message : String(error)}`
    )
  }

  // Validate schema
  const result = evalConfigFileSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")
    throw new Error(`Invalid config file: ${filePath}\n${issues}`)
  }

  return result.data
}

/**
 * Check if a file path looks like a config file (YAML extension).
 */
export function isConfigFilePath(path: string): boolean {
  return path.endsWith(".yaml") || path.endsWith(".yml")
}
