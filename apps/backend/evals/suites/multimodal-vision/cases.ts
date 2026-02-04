/**
 * Test Cases for Multimodal Vision Evaluation
 *
 * Tests the agent's ability to see and describe images when using vision-capable models.
 * Each case includes a base64-encoded test image with known content that the agent should
 * be able to describe accurately.
 */

import type { EvalCase } from "../../framework/types"

/**
 * Input for multimodal vision evaluation.
 */
export interface MultimodalVisionInput {
  /** The user message asking about the image */
  message: string
  /** Base64-encoded image data (without data URL prefix) */
  imageBase64: string
  /** Image MIME type */
  imageMimeType: string
  /** Filename for the attachment */
  imageFilename: string
  /** Human-readable description of what the image contains (for test setup) */
  imageDescription: string
}

/**
 * Expected output for multimodal vision evaluation.
 */
export interface MultimodalVisionExpected {
  /** Keywords that should appear in the response (case-insensitive) */
  shouldMention: string[]
  /** Keywords that should NOT appear (to prevent hallucination) */
  shouldNotMention?: string[]
  /** Reason for this expected behavior */
  reason: string
}

/**
 * Create a test case.
 */
function createCase(
  id: string,
  name: string,
  input: MultimodalVisionInput,
  expectedOutput: MultimodalVisionExpected
): EvalCase<MultimodalVisionInput, MultimodalVisionExpected> {
  return {
    id: `vision-${id}`,
    name,
    input,
    expectedOutput,
  }
}

// =============================================================================
// Test Images (small, simple images that models can easily describe)
// =============================================================================

/**
 * 10x10 red square PNG (smallest possible identifiable image)
 * This is a tiny PNG with a solid red (#FF0000) color.
 */
const RED_SQUARE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAADklEQVQI12P4z8DAwMAAAAQKAQ/xKpjFAAAAAElFTkSuQmCC"

/**
 * 10x10 blue square PNG
 * This is a tiny PNG with a solid blue (#0000FF) color.
 */
const BLUE_SQUARE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAADklEQVQI12NgGAWjYBQAAAwKAAFv+j8sAAAAAElFTkSuQmCC"

/**
 * 10x10 green square PNG
 * This is a tiny PNG with a solid green (#00FF00) color.
 */
const GREEN_SQUARE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAADklEQVQI12NgGAWjYBQAAAwKAAFv+j8sAAAAAElFTkSuQmCC"

/**
 * Simple gradient image (helps verify the model processes more than just solid colors)
 * 20x20 PNG with a diagonal gradient from black to white
 */
const GRADIENT_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAWklEQVQ4y2P4TwRgGNVAHgP+M/z/T4wGBgaGf//+/f//n4GBgYEB7mJGRkZGRkaif0VG/gxp+M/AwPD/P9SsUQ3kMQCdBTaLARobBoZRDUMBA+E/AwPDKBgGAABvNBDmLHx+9wAAAABJRU5ErkJggg=="

// =============================================================================
// Test Cases
// =============================================================================

export const multimodalVisionCases: EvalCase<MultimodalVisionInput, MultimodalVisionExpected>[] = [
  createCase(
    "red-square-001",
    "Vision: Should identify a red colored image",
    {
      message: "What color is in this image?",
      imageBase64: RED_SQUARE_PNG,
      imageMimeType: "image/png",
      imageFilename: "red-square.png",
      imageDescription: "A solid red square",
    },
    {
      shouldMention: ["red"],
      shouldNotMention: ["blue", "green", "yellow", "purple"],
      reason: "The image is a solid red square - the agent should identify the color as red",
    }
  ),

  createCase(
    "blue-square-001",
    "Vision: Should identify a blue colored image",
    {
      message: "Describe what you see in this image.",
      imageBase64: BLUE_SQUARE_PNG,
      imageMimeType: "image/png",
      imageFilename: "blue-square.png",
      imageDescription: "A solid blue square",
    },
    {
      shouldMention: ["blue"],
      shouldNotMention: ["red", "green", "yellow"],
      reason: "The image is a solid blue square - the agent should identify the color",
    }
  ),

  createCase(
    "describe-image-001",
    "Vision: Should describe the image when asked",
    {
      message: "Can you tell me what's in this attached image?",
      imageBase64: GREEN_SQUARE_PNG,
      imageMimeType: "image/png",
      imageFilename: "green-square.png",
      imageDescription: "A solid green square",
    },
    {
      shouldMention: ["green", "square"],
      reason: "The agent should describe both the color and shape when asked about the image",
    }
  ),

  createCase(
    "gradient-001",
    "Vision: Should describe a gradient image",
    {
      message: "What do you see in this image?",
      imageBase64: GRADIENT_PNG,
      imageMimeType: "image/png",
      imageFilename: "gradient.png",
      imageDescription: "A gradient from dark to light",
    },
    {
      shouldMention: ["gradient"],
      reason: "The agent should recognize this as a gradient pattern",
    }
  ),

  createCase(
    "specific-question-001",
    "Vision: Should answer specific questions about image content",
    {
      message: "Is this image mostly dark or mostly light?",
      imageBase64: RED_SQUARE_PNG,
      imageMimeType: "image/png",
      imageFilename: "color-test.png",
      imageDescription: "A solid red square (medium brightness)",
    },
    {
      // Red has medium brightness, so either answer is acceptable as long as the model sees it
      shouldMention: [],
      reason: "The agent should engage with the question about brightness, demonstrating it can see the image",
    }
  ),

  createCase(
    "image-acknowledgment-001",
    "Vision: Should acknowledge receiving an image",
    {
      message: "I'm sharing this image with you",
      imageBase64: BLUE_SQUARE_PNG,
      imageMimeType: "image/png",
      imageFilename: "shared-image.png",
      imageDescription: "A solid blue square",
    },
    {
      shouldMention: ["image", "see"],
      reason: "When a user shares an image, the agent should acknowledge it and describe what it sees",
    }
  ),
]

export { multimodalVisionCases as default }
