/**
 * Test utilities - import from "@/test" for all test helpers.
 *
 * @example
 * ```tsx
 * import { render, screen, userEvent, waitFor, spyOnExport } from "@/test"
 * import { createMockStream, mockStreams, mockUsers } from "@/test/fixtures"
 * ```
 */

// Re-export render utilities
export * from "./render"

// Spy helper for replacing const-like module exports in tests
export { spyOnExport } from "./spy"

// Fixtures live in "@/test/fixtures" for data factories.
