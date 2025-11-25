import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Toaster } from "sonner"
import { AuthProvider } from "./auth"
import { ThemeProvider } from "./contexts/ThemeContext"
import { LayoutSystem } from "./components/layout/LayoutSystem"
import "./index.css"

function App() {
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
