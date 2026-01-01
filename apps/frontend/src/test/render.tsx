import type { ReactElement, ReactNode } from "react"
import { render, type RenderOptions } from "@testing-library/react"

/**
 * Wrapper component for tests that need common providers.
 * Currently minimal - add providers here as needed (e.g., QueryClientProvider, ThemeProvider).
 */
function TestProviders({ children }: { children: ReactNode }) {
  return <>{children}</>
}

/**
 * Custom render function that wraps components with test providers.
 * Use this instead of @testing-library/react's render for integration tests.
 *
 * @example
 * ```tsx
 * import { renderWithProviders, screen } from "@/test"
 *
 * it("should render", () => {
 *   renderWithProviders(<MyComponent />)
 *   expect(screen.getByText("Hello")).toBeInTheDocument()
 * })
 * ```
 */
export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, { wrapper: TestProviders, ...options })
}

// Re-export everything from testing-library for convenience
export * from "@testing-library/react"
export { default as userEvent } from "@testing-library/user-event"

// Override render with our wrapped version as the default export
export { renderWithProviders as render }
