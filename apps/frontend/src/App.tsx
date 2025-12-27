import { RouterProvider } from "react-router-dom"
import { AuthProvider } from "./auth"
import {
  QueryClientProvider,
  ServicesProvider,
  SocketProvider,
  PendingMessagesProvider,
  ThemeProvider,
} from "./contexts"
import { usePendingMessageRetry } from "./hooks"
import { router } from "./routes"

function PendingMessageRetryHandler() {
  usePendingMessageRetry()
  return null
}

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <QueryClientProvider>
          <ServicesProvider>
            <SocketProvider>
              <PendingMessagesProvider>
                <PendingMessageRetryHandler />
                <RouterProvider router={router} />
              </PendingMessagesProvider>
            </SocketProvider>
          </ServicesProvider>
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
