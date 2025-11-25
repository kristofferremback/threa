import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Toaster } from "sonner"
import { AuthProvider } from "./auth"
import { ThemeProvider } from "./contexts/ThemeContext"
import { LayoutSystem } from "./components/layout/LayoutSystem"
import { InvitePage } from "./components/InvitePage"
import "./index.css"

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
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)
