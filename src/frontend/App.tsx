import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Toaster } from "sonner"
import { AuthProvider } from "./auth"
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
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
