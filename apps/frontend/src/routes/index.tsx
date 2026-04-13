import { useEffect, useRef } from "react"
import { createBrowserRouter, Navigate, useLocation, useParams } from "react-router-dom"
import { ErrorBoundary } from "@/components/error-boundary"
import { useSidebar } from "@/contexts"
import { useLastStream } from "@/hooks"

// Route-level code splitting: each page lazy-loads its own chunk so heavy
// dependencies (tiptap/prosemirror, recharts, limax/pinyin-pro, etc.) ride
// with the pages that actually use them instead of bloating the main bundle.
export const router = createBrowserRouter([
  {
    path: "/",
    element: <Navigate to="/workspaces" replace />,
    errorElement: <ErrorBoundary />,
  },
  {
    path: "/login",
    lazy: async () => ({ Component: (await import("@/pages/login")).LoginPage }),
    errorElement: <ErrorBoundary />,
  },
  {
    path: "/workspaces",
    lazy: async () => ({ Component: (await import("@/pages/workspace-select")).WorkspaceSelectPage }),
    errorElement: <ErrorBoundary />,
  },
  {
    path: "/share",
    lazy: async () => ({ Component: (await import("@/pages/share-target")).ShareTargetPage }),
    errorElement: <ErrorBoundary />,
  },
  {
    // Setup page lives outside WorkspaceLayout — it's a lightweight form that
    // doesn't need the full workspace bootstrap (socket, sidebar, etc.)
    path: "/w/:workspaceId/setup",
    lazy: async () => ({ Component: (await import("@/pages/user-setup")).UserSetupPage }),
    errorElement: <ErrorBoundary />,
  },
  {
    path: "/w/:workspaceId",
    lazy: async () => ({ Component: (await import("@/pages/workspace-layout")).WorkspaceLayout }),
    errorElement: <ErrorBoundary />,
    children: [
      {
        index: true,
        element: <WorkspaceHome />,
      },
      {
        path: "drafts",
        lazy: async () => ({ Component: (await import("@/pages/drafts")).DraftsPage }),
      },
      {
        path: "threads",
        lazy: async () => ({ Component: (await import("@/pages/threads")).ThreadsPage }),
      },
      {
        path: "activity",
        lazy: async () => ({ Component: (await import("@/pages/activity")).ActivityPage }),
      },
      {
        path: "memory",
        lazy: async () => ({ Component: (await import("@/pages/memory")).MemoryPage }),
      },
      {
        path: "memos/:memoId",
        element: <LegacyMemoRedirect />,
      },
      {
        path: "s/:streamId",
        lazy: async () => ({ Component: (await import("@/pages/stream")).StreamPage }),
      },
      {
        path: "share",
        lazy: async () => ({ Component: (await import("@/pages/share-picker")).SharePickerPage }),
      },
      {
        path: "admin/ai-usage",
        lazy: async () => ({ Component: (await import("@/pages/ai-usage-admin")).AIUsageAdminPage }),
      },
    ],
  },
])

/** Workspace index route — redirects to a stream or opens the sidebar. */
export function WorkspaceHome() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const location = useLocation()
  const { state, togglePinned } = useSidebar()
  const { redirectStreamId, shouldOpenSidebar } = useLastStream(workspaceId ?? "")
  const sidebarOpenedRef = useRef(false)

  useEffect(() => {
    if (shouldOpenSidebar && state === "collapsed" && !sidebarOpenedRef.current) {
      sidebarOpenedRef.current = true
      togglePinned()
    }
  }, [shouldOpenSidebar, state, togglePinned])

  if (redirectStreamId && workspaceId) {
    return (
      <Navigate
        to={{
          pathname: `/w/${workspaceId}/s/${redirectStreamId}`,
          search: location.search,
        }}
        replace
      />
    )
  }

  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <p>Select a stream from the sidebar</p>
    </div>
  )
}

export function LegacyMemoRedirect() {
  const { workspaceId, memoId } = useParams<{ workspaceId: string; memoId: string }>()
  const location = useLocation()

  if (!workspaceId || !memoId) {
    return <Navigate to="/workspaces" replace />
  }

  const params = new URLSearchParams(location.search)
  params.set("memo", memoId)

  return (
    <Navigate
      to={{
        pathname: `/w/${workspaceId}/memory`,
        search: `?${params.toString()}`,
      }}
      replace
    />
  )
}
