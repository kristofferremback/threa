import { createContext, useContext, useMemo, type ReactNode } from "react"
import { workspacesApi, streamsApi, messagesApi, conversationsApi, activityApi } from "@/api"

// Service interfaces - components depend on these, not implementations
export interface WorkspaceService {
  list: typeof workspacesApi.list
  get: typeof workspacesApi.get
  bootstrap: typeof workspacesApi.bootstrap
  create: typeof workspacesApi.create
  markAllAsRead: typeof workspacesApi.markAllAsRead
  updateProfile: typeof workspacesApi.updateProfile
  uploadAvatar: typeof workspacesApi.uploadAvatar
  removeAvatar: typeof workspacesApi.removeAvatar
}

export interface StreamService {
  list: typeof streamsApi.list
  get: typeof streamsApi.get
  bootstrap: typeof streamsApi.bootstrap
  create: typeof streamsApi.create
  update: typeof streamsApi.update
  archive: typeof streamsApi.archive
  unarchive: typeof streamsApi.unarchive
  getEvents: typeof streamsApi.getEvents
  markAsRead: typeof streamsApi.markAsRead
  checkSlugAvailable: typeof streamsApi.checkSlugAvailable
  setNotificationLevel: typeof streamsApi.setNotificationLevel
  addMember: typeof streamsApi.addMember
  removeMember: typeof streamsApi.removeMember
}

export interface MessageService {
  create: typeof messagesApi.create
  createDm: typeof messagesApi.createDm
  update: typeof messagesApi.update
  delete: typeof messagesApi.delete
  addReaction: typeof messagesApi.addReaction
  removeReaction: typeof messagesApi.removeReaction
}

export interface ConversationService {
  listByStream: typeof conversationsApi.listByStream
  getById: typeof conversationsApi.getById
  getMessages: typeof conversationsApi.getMessages
}

export interface ActivityService {
  list: typeof activityApi.list
  markAsRead: typeof activityApi.markAsRead
  markAllAsRead: typeof activityApi.markAllAsRead
}

export interface Services {
  workspaces: WorkspaceService
  streams: StreamService
  messages: MessageService
  conversations: ConversationService
  activity: ActivityService
}

const ServicesContext = createContext<Services | null>(null)

interface ServicesProviderProps {
  children: ReactNode
  // Allow overriding services for testing
  services?: Partial<Services>
}

export function ServicesProvider({ children, services: overrides }: ServicesProviderProps) {
  const services = useMemo<Services>(
    () => ({
      workspaces: overrides?.workspaces ?? workspacesApi,
      streams: overrides?.streams ?? streamsApi,
      messages: overrides?.messages ?? messagesApi,
      conversations: overrides?.conversations ?? conversationsApi,
      activity: overrides?.activity ?? activityApi,
    }),
    [overrides]
  )

  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>
}

export function useServices(): Services {
  const services = useContext(ServicesContext)
  if (!services) {
    throw new Error("useServices must be used within a ServicesProvider")
  }
  return services
}

// Convenience hooks for individual services
export function useWorkspaceService(): WorkspaceService {
  return useServices().workspaces
}

export function useStreamService(): StreamService {
  return useServices().streams
}

export function useMessageService(): MessageService {
  return useServices().messages
}

export function useConversationService(): ConversationService {
  return useServices().conversations
}

export function useActivityService(): ActivityService {
  return useServices().activity
}
