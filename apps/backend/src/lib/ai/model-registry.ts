import { readFileSync } from "fs"
import { join } from "path"
import * as yaml from "yaml"

/**
 * Input modality types supported by models.
 */
export type InputModality = "text" | "image"

/**
 * Output modality types supported by models.
 */
export type OutputModality = "text" | "embedding"

/**
 * Model capabilities definition.
 */
export interface ModelCapabilities {
  name: string
  inputModalities: InputModality[]
  outputModalities: OutputModality[]
}

/**
 * YAML file structure.
 */
interface ModelsYaml {
  models: Record<string, ModelCapabilities>
}

/**
 * Registry for looking up model capabilities.
 */
export interface ModelRegistry {
  /**
   * Get capabilities for a model by its ID.
   * Returns undefined if model is not registered.
   */
  getCapabilities(modelId: string): ModelCapabilities | undefined

  /**
   * Check if a model supports vision (image input).
   * Returns false for unknown models.
   */
  supportsVision(modelId: string): boolean

  /**
   * Check if a model supports a specific input modality.
   * Returns false for unknown models.
   */
  supportsInputModality(modelId: string, modality: InputModality): boolean

  /**
   * Check if a model supports a specific output modality.
   * Returns false for unknown models.
   */
  supportsOutputModality(modelId: string, modality: OutputModality): boolean

  /**
   * Get all registered model IDs.
   */
  getModelIds(): string[]
}

/**
 * Create a model registry by loading from models.yaml.
 */
export function createModelRegistry(): ModelRegistry {
  const yamlPath = join(__dirname, "models.yaml")
  const content = readFileSync(yamlPath, "utf-8")
  const parsed = yaml.parse(content) as ModelsYaml

  const models = new Map<string, ModelCapabilities>()
  for (const [modelId, capabilities] of Object.entries(parsed.models)) {
    models.set(modelId, capabilities)
  }

  return {
    getCapabilities(modelId: string): ModelCapabilities | undefined {
      return models.get(modelId)
    },

    supportsVision(modelId: string): boolean {
      const caps = models.get(modelId)
      return caps?.inputModalities.includes("image") ?? false
    },

    supportsInputModality(modelId: string, modality: InputModality): boolean {
      const caps = models.get(modelId)
      return caps?.inputModalities.includes(modality) ?? false
    },

    supportsOutputModality(modelId: string, modality: OutputModality): boolean {
      const caps = models.get(modelId)
      return caps?.outputModalities.includes(modality) ?? false
    },

    getModelIds(): string[] {
      return Array.from(models.keys())
    },
  }
}
