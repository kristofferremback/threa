import React, { createContext, useCallback, useContext, useState, type ReactNode } from "react"

import { UserProfileModal } from "./user-profile-modal"

interface UserProfileContextValue {
  openUserProfile: (userId: string) => void
}

const UserProfileContext = createContext<UserProfileContextValue | null>(null)

interface UserProfileProviderProps {
  children: ReactNode
}

export function UserProfileProvider({ children }: UserProfileProviderProps) {
  const [targetUserId, setTargetUserId] = useState<string | null>(null)

  const openUserProfile = useCallback((userId: string) => {
    setTargetUserId(userId)
  }, [])

  const close = useCallback(() => {
    setTargetUserId(null)
  }, [])

  return (
    <UserProfileContext.Provider value={{ openUserProfile }}>
      {children}
      {targetUserId && (
        <React.Suspense fallback={null}>
          <UserProfileModal userId={targetUserId} open onOpenChange={(open) => !open && close()} />
        </React.Suspense>
      )}
    </UserProfileContext.Provider>
  )
}

export function useUserProfile(): UserProfileContextValue {
  const context = useContext(UserProfileContext)
  if (!context) {
    throw new Error("useUserProfile must be used within a UserProfileProvider")
  }
  return context
}
