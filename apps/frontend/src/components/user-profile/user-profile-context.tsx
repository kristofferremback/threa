import { createContext, useCallback, useContext, useState, type ReactNode } from "react"

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
      {targetUserId && <UserProfileModalLazy userId={targetUserId} onClose={close} />}
    </UserProfileContext.Provider>
  )
}

const NOOP_CONTEXT: UserProfileContextValue = {
  openUserProfile: () => {},
}

export function useUserProfile(): UserProfileContextValue {
  const context = useContext(UserProfileContext)
  return context ?? NOOP_CONTEXT
}

// Lazy import to keep the context file lightweight
import { UserProfileModal } from "./user-profile-modal"

function UserProfileModalLazy({ userId, onClose }: { userId: string; onClose: () => void }) {
  return <UserProfileModal userId={userId} open onOpenChange={(open) => !open && onClose()} />
}
