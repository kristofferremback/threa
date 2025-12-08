import { AuthProvider, useAuth } from "./auth"

function Home() {
  const { user, loading, login, logout } = useAuth()

  if (loading) {
    return <div>Loading...</div>
  }

  if (!user) {
    return (
      <div>
        <h1>Welcome to Threa</h1>
        <button onClick={() => login()}>Login</button>
      </div>
    )
  }

  return (
    <div>
      <h1>Welcome, {user.name}</h1>
      <p>Email: {user.email}</p>
      <button onClick={logout}>Logout</button>
    </div>
  )
}

export function App() {
  return (
    <AuthProvider>
      <Home />
    </AuthProvider>
  )
}
