/**
 * Types for evaluation config files.
 *
 * Config files allow fine-grained control over evaluation runs,
 * including per-component model/temperature overrides.
 */

import { z } from "zod"

/**
 * Configuration for a single component within a suite.
 * All fields are optional - sparse configuration is allowed.
 */
export const componentConfigSchema = z.object({
  /** Model to use for this component (provider:modelPath format) */
  model: z.string().optional(),
  /** Temperature for this component (0.0 to 1.0) */
  temperature: z.number().min(0).max(2).optional(),
  /** Prompt override (supports {{PARAMETER}} template syntax) */
  prompt: z.string().optional(),
})

export type ComponentConfig = z.infer<typeof componentConfigSchema>

/**
 * Configuration for a single suite run.
 */
export const suiteRunConfigSchema = z.object({
  /** Name of the suite to run */
  name: z.string(),
  /** Title for this run (for display and identification) */
  title: z.string(),
  /** Component-specific overrides (sparse configuration allowed) */
  components: z.record(z.string(), componentConfigSchema).optional(),
  /** Filter to specific case IDs */
  cases: z.array(z.string()).optional(),
})

export type SuiteRunConfig = z.infer<typeof suiteRunConfigSchema>

/**
 * Root configuration file schema.
 */
export const evalConfigFileSchema = z.object({
  /** List of suite runs to execute */
  suites: z.array(suiteRunConfigSchema),
})

export type EvalConfigFile = z.infer<typeof evalConfigFileSchema>

/**
 * Component overrides passed to suite task functions via EvalContext.
 */
export type ComponentOverrides = Record<string, ComponentConfig>
