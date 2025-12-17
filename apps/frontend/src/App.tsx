import { RouterProvider } from "react-router-dom"
import { AuthProvider } from "./auth"
import { QueryClientProvider, ServicesProvider } from "./contexts"
import { router } from "./routes"

export function App() {
  return (
    <AuthProvider>
      <QueryClientProvider>
        <ServicesProvider>
          <RouterProvider router={router} />
        </ServicesProvider>
      </QueryClientProvider>
    </AuthProvider>
  )
}
