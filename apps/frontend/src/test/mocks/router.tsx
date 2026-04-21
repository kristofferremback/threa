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
 * Builds an object implementing the shape of react-router-dom for tests that
 * want to substitute navigation behavior. Install selected members via
 * `vi.spyOn(routerModule, "useNavigate").mockReturnValue(mockNavigate)` etc.
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
