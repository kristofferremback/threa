import type React from "react"
import { vi } from "vitest"

/**
 * Mock navigate function - reset between tests with mockNavigate.mockClear()
 */
export const mockNavigate = vi.fn()

/**
 * Default params returned by useParams.
 * Override per-test by calling mockUseParams.mockReturnValue({...})
 */
export const mockUseParams = vi.fn(() => ({ workspaceId: "workspace_1" }))

/**
 * Creates a mock for react-router-dom.
 * Use with: vi.mock("react-router-dom", () => createRouterMock())
 *
 * @example
 * ```ts
 * import { createRouterMock, mockNavigate } from "@/test/mocks"
 *
 * vi.mock("react-router-dom", () => createRouterMock())
 *
 * beforeEach(() => {
 *   mockNavigate.mockClear()
 * })
 * ```
 */
export function createRouterMock() {
  return {
    useNavigate: () => mockNavigate,
    useParams: mockUseParams,
    useLocation: () => ({ pathname: "/", search: "", hash: "", state: null, key: "default" }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
    Link: ({
      to,
      children,
      className,
      onClick,
      ...props
    }: {
      to: string
      children: React.ReactNode
      className?: string
      onClick?: (e: React.MouseEvent) => void
    }) => (
      <a href={to} className={className} onClick={onClick} {...props}>
        {children}
      </a>
    ),
    NavLink: ({
      to,
      children,
      className,
      ...props
    }: {
      to: string
      children: React.ReactNode
      className?: string | ((props: { isActive: boolean }) => string)
    }) => (
      <a href={to} className={typeof className === "function" ? className({ isActive: false }) : className} {...props}>
        {children}
      </a>
    ),
  }
}
