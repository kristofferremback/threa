import { RouterProvider } from "react-router-dom"
import { AuthProvider } from "./auth"
import { QueryClientProvider, ServicesProvider, SocketProvider } from "./contexts"
import { router } from "./routes"

export function App() {
  return (
    <AuthProvider>
      <QueryClientProvider>
        <ServicesProvider>
          <SocketProvider>
            <RouterProvider router={router} />
          </SocketProvider>
        </ServicesProvider>
      </QueryClientProvider>
    </AuthProvider>
  )
}
