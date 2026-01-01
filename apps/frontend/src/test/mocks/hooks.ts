import { vi } from "vitest"
import type { Stream, User, WorkspaceMember, Persona } from "@threa/types"
import { mockStreamsList } from "../fixtures/streams"
import { mockUsersList, mockMembersList } from "../fixtures/users"
import type { MockSearchResult } from "../fixtures/messages"

/**
 * Bootstrap data shape returned by useWorkspaceBootstrap.
 */
export interface MockBootstrapData {
  streams: Stream[]
  users: User[]
  members: WorkspaceMember[]
  personas: Persona[]
}

/**
 * Default bootstrap data using fixtures.
 */
export const defaultBootstrapData: MockBootstrapData = {
  streams: mockStreamsList,
  users: mockUsersList,
  members: mockMembersList,
  personas: [],
}

/**
 * Configurable search state for useSearch mock.
 */
export interface MockSearchState {
  results: MockSearchResult[]
  isLoading: boolean
  search: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
}

/**
 * Create default search state - call this in beforeEach to get fresh mocks.
 */
export function createMockSearchState(): MockSearchState {
  return {
    results: [],
    isLoading: false,
    search: vi.fn(),
    clear: vi.fn(),
  }
}

/**
 * Creates a mock for @/hooks module.
 *
 * @param options.bootstrap - Override bootstrap data (defaults to fixtures)
 * @param options.searchState - Search state (create with createMockSearchState())
 *
 * @example
 * ```ts
 * import { createHooksMock, createMockSearchState, defaultBootstrapData } from "@/test/mocks"
 * import { createMockStream } from "@/test/fixtures"
 *
 * let searchState: MockSearchState
 *
 * vi.mock("@/hooks", () => createHooksMock({
 *   bootstrap: {
 *     ...defaultBootstrapData,
 *     streams: [...defaultBootstrapData.streams, createMockStream({ id: "custom", type: "channel" })],
 *   },
 *   getSearchState: () => searchState,
 * }))
 *
 * beforeEach(() => {
 *   searchState = createMockSearchState()
 * })
 * ```
 */
export function createHooksMock(options?: {
  bootstrap?: Partial<MockBootstrapData>
  getSearchState?: () => MockSearchState
}) {
  const bootstrap = { ...defaultBootstrapData, ...options?.bootstrap }
  const getSearchState = options?.getSearchState ?? (() => createMockSearchState())

  return {
    useWorkspaceBootstrap: () => ({
      data: bootstrap,
      isLoading: false,
      error: null,
    }),

    useSearch: () => {
      const state = getSearchState()
      return {
        results: state.results,
        isLoading: state.isLoading,
        search: state.search,
        clear: state.clear,
      }
    },

    useDraftScratchpads: () => ({
      drafts: [],
      createDraft: vi.fn().mockResolvedValue({ id: "draft_new", type: "scratchpad" }),
      deleteDraft: vi.fn(),
    }),

    useCreateStream: () => ({
      mutateAsync: vi.fn().mockResolvedValue({ id: "stream_new", type: "channel" }),
      isPending: false,
    }),
  }
}
