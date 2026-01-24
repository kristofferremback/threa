/**
 * StaticConfigResolver - Production Configuration
 *
 * Provides default configs for all AI components, importing from their
 * co-located config.ts files (INV-43). Supports optional overrides at
 * construction time for testing or per-environment configuration.
 */

import type { ConfigResolver, ComponentConfig } from "./config-resolver"
import { COMPONENT_PATHS } from "./config-resolver"

// Import from co-located configs (INV-43)
import {
  BOUNDARY_EXTRACTION_MODEL_ID,
  BOUNDARY_EXTRACTION_TEMPERATURE,
  BOUNDARY_EXTRACTION_SYSTEM_PROMPT,
} from "../boundary-extraction/config"
import { STREAM_NAMING_MODEL_ID, STREAM_NAMING_TEMPERATURE } from "../../services/stream-naming/config"
import { MEMO_MODEL_ID, MEMO_TEMPERATURES } from "../memo/config"
import {
  RESEARCHER_MODEL_ID,
  RESEARCHER_MAX_ITERATIONS,
  RESEARCHER_MAX_RESULTS_PER_SEARCH,
} from "../../agents/researcher/config"
import { COMPANION_MODEL_ID, COMPANION_TEMPERATURE } from "../../agents/companion/config"

// Embedding model - no co-located config exists
const EMBEDDING_MODEL_ID = "openrouter:openai/text-embedding-3-small"

// -----------------------------------------------------------------------------
// Default Configs
// -----------------------------------------------------------------------------

/**
 * Build default configs for all components.
 * Internal structure uses string keys with extended properties.
 */
function buildDefaultConfigs(): Map<string, ComponentConfig> {
  const configs = new Map<string, ComponentConfig>()

  configs.set(COMPONENT_PATHS.BOUNDARY_EXTRACTION, {
    modelId: BOUNDARY_EXTRACTION_MODEL_ID,
    temperature: BOUNDARY_EXTRACTION_TEMPERATURE,
    systemPrompt: BOUNDARY_EXTRACTION_SYSTEM_PROMPT,
  })

  configs.set(COMPONENT_PATHS.STREAM_NAMING, {
    modelId: STREAM_NAMING_MODEL_ID,
    temperature: STREAM_NAMING_TEMPERATURE,
  })

  configs.set(COMPONENT_PATHS.MEMO_CLASSIFIER, {
    modelId: MEMO_MODEL_ID,
    temperature: MEMO_TEMPERATURES.classification,
  })

  configs.set(COMPONENT_PATHS.MEMO_MEMORIZER, {
    modelId: MEMO_MODEL_ID,
    temperature: MEMO_TEMPERATURES.memorization,
  })

  configs.set(COMPONENT_PATHS.COMPANION_AGENT, {
    modelId: COMPANION_MODEL_ID,
    temperature: COMPANION_TEMPERATURE,
  })

  configs.set(COMPONENT_PATHS.COMPANION_RESEARCHER, {
    modelId: RESEARCHER_MODEL_ID,
    maxIterations: RESEARCHER_MAX_ITERATIONS,
    maxResultsPerSearch: RESEARCHER_MAX_RESULTS_PER_SEARCH,
  })

  configs.set(COMPONENT_PATHS.EMBEDDING, {
    modelId: EMBEDDING_MODEL_ID,
  })

  return configs
}

// Build once at module load
const DEFAULT_CONFIGS = buildDefaultConfigs()

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------

export interface StaticConfigResolverOptions {
  /**
   * Optional overrides for specific component paths.
   * Merged with defaults (overrides win).
   */
  overrides?: Partial<Record<string, Partial<ComponentConfig>>>
}

/**
 * Create a static config resolver with production defaults.
 *
 * @param options Optional overrides
 * @returns ConfigResolver instance
 *
 * @example Production usage
 * const resolver = createStaticConfigResolver()
 * const config = await resolver.resolve("boundary-extraction")
 *
 * @example With overrides (e.g., for testing)
 * const resolver = createStaticConfigResolver({
 *   overrides: {
 *     "boundary-extraction": { modelId: "openrouter:anthropic/claude-haiku-4.5" }
 *   }
 * })
 */
export function createStaticConfigResolver(options: StaticConfigResolverOptions = {}): ConfigResolver {
  const { overrides = {} } = options

  return {
    async resolve<T extends ComponentConfig = ComponentConfig>(path: string): Promise<T> {
      const defaultConfig = DEFAULT_CONFIGS.get(path)

      if (!defaultConfig) {
        const knownPaths = Array.from(DEFAULT_CONFIGS.keys()).join(", ")
        throw new Error(`Unknown config path: "${path}". Known paths: ${knownPaths}`)
      }

      const override = overrides[path]

      if (!override) {
        return defaultConfig as T
      }

      return { ...defaultConfig, ...override } as T
    },
  }
}

// -----------------------------------------------------------------------------
// Convenience Export
// -----------------------------------------------------------------------------

/**
 * Default production resolver instance.
 * Use createStaticConfigResolver() if you need custom overrides.
 */
export const defaultConfigResolver = createStaticConfigResolver()
