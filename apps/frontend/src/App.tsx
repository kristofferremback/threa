import { RouterProvider } from "react-router-dom"
import { AuthProvider } from "./auth"
import { QueryClientProvider, ServicesProvider, SocketProvider, PendingMessagesProvider } from "./contexts"
import { usePendingMessageRetry } from "./hooks"
import { router } from "./routes"
import { TooltipProvider } from "./components/ui/tooltip"

function PendingMessageRetryHandler() {
  usePendingMessageRetry()
  return null
}

export function App() {
  return (
    <AuthProvider>
      <QueryClientProvider>
        <ServicesProvider>
          <SocketProvider>
            <PendingMessagesProvider>
              <TooltipProvider delayDuration={300}>
                <PendingMessageRetryHandler />
                <RouterProvider router={router} />
              </TooltipProvider>
            </PendingMessagesProvider>
          </SocketProvider>
        </ServicesProvider>
      </QueryClientProvider>
    </AuthProvider>
  )
}
