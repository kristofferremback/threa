/**
 * Test utilities - import from "@/test" for all test helpers.
 *
 * @example
 * ```tsx
 * import { render, screen, userEvent, waitFor } from "@/test"
 * import { mockNavigate, createRouterMock, createHooksMock, createMockSearchState } from "@/test/mocks"
 * import { createMockStream, mockStreams, mockUsers } from "@/test/fixtures"
 * ```
 */

// Re-export render utilities
export * from "./render"

// Fixtures and mocks are imported from their own paths for clarity:
// - "@/test/fixtures" for data factories
// - "@/test/mocks" for vi.mock() factories
