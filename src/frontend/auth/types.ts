// Loading is a generic type that takes an object type T and merges it with the state property or an error.
export type Loading<T> = { state: "new" | "loading" | "loaded" | "error"; error?: Error } & T

// Copied from WorkOS User type
export type User = {
  id: string
  email: string
  emailVerified: boolean
  profilePictureUrl: string | null
  firstName: string | null
  lastName: string | null
  lastSignInAt: string | null
  locale: string | null
  createdAt: string
  updatedAt: string
  externalId: string | null
  metadata: Record<string, string>
}
