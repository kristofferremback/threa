import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Toaster } from "sonner"
import { AuthProvider } from "./auth"
import { ThemeProvider } from "./contexts/ThemeContext"
import { OfflineProvider } from "./contexts/OfflineContext"
import { QueryProvider } from "./contexts/QueryContext"
import { LayoutSystem } from "./components/layout/LayoutSystem"
import { InvitePage } from "./components/InvitePage"
import { startOutboxWorker } from "./workers/outbox-worker"
import "./index.css"

// Start the outbox worker which handles sending messages in the background.
// It loads persisted messages and resets any stuck "sending" state.
startOutboxWorker()

function App() {
  // Simple URL-based routing
  const path = window.location.pathname
  const inviteMatch = path.match(/^\/invite\/([^/]+)$/)

  if (inviteMatch) {
    const token = inviteMatch[1]
    return (
      <>
        <Toaster position="top-center" richColors />
        <InvitePage token={token} />
      </>
    )
  }

  return (
    <>
      <Toaster position="top-center" richColors />
      <LayoutSystem />
    </>
  )
}

const root = createRoot(document.getElementById("root")!)
root.render(
  <StrictMode>
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>
          <OfflineProvider>
            <App />
          </OfflineProvider>
        </AuthProvider>
      </QueryProvider>
    </ThemeProvider>
  </StrictMode>,
)
