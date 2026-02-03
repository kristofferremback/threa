/**
 * Types for Multimodal Vision Evaluation
 */

import type { MultimodalVisionInput, MultimodalVisionExpected } from "./cases"

/**
 * A message sent by the agent in response to an image.
 */
export interface VisionMessage {
  /** Message content */
  content: string
}

/**
 * Output from the multimodal vision evaluation task.
 */
export interface MultimodalVisionOutput {
  /** The input that was provided */
  input: MultimodalVisionInput
  /** Messages sent by the agent */
  messages: VisionMessage[]
  /** Whether the agent responded */
  responded: boolean
  /** Error if the task failed */
  error?: string
}

// Re-export input and expected types
export type { MultimodalVisionInput, MultimodalVisionExpected }
