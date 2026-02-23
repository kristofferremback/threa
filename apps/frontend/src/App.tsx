import { RouterProvider } from "react-router-dom"
import { AuthProvider } from "./auth"
import { QueryClientProvider, ServicesProvider, PendingMessagesProvider } from "./contexts"
import { router } from "./routes"
import { TooltipProvider } from "./components/ui/tooltip"

export function App() {
  return (
    <AuthProvider>
      <QueryClientProvider>
        <ServicesProvider>
          <PendingMessagesProvider>
            <TooltipProvider delayDuration={300}>
              <RouterProvider router={router} />
            </TooltipProvider>
          </PendingMessagesProvider>
        </ServicesProvider>
      </QueryClientProvider>
    </AuthProvider>
  )
}
