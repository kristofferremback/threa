export interface User {
  id: string
  email: string
  name: string
  isPlatformAdmin: boolean
}

export interface AuthState {
  user: User | null
  loading: boolean
  error: string | null
}
