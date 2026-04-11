import { RouterProvider } from "react-router-dom"
import { AuthProvider } from "@/auth"
import { QueryClientProvider } from "@/providers/query-client-provider"
import { router } from "@/routes"

export function App() {
  return (
    <AuthProvider>
      <QueryClientProvider>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AuthProvider>
  )
}
