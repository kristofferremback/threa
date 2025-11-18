export interface JWTPayload {
  userId: string
  email: string
  exp: number
}

export interface Session {
  accessToken: string
  refreshToken: string
  userId: string
  email: string
}

export interface WSData {
  userId: string
  email: string
}
