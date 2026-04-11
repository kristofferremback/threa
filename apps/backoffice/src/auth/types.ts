export interface BackofficeUser {
  id: string
  email: string
  name: string
  isPlatformAdmin: boolean
}

export interface AuthState {
  user: BackofficeUser | null
  loading: boolean
  error: string | null
}
