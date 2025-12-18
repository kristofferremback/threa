// Constants and their types
export {
  // Stream types
  STREAM_TYPES,
  type StreamType,
  StreamTypes,
  // Visibility
  VISIBILITY_OPTIONS,
  type Visibility,
  Visibilities,
  // Companion modes
  COMPANION_MODES,
  type CompanionMode,
  CompanionModes,
  // Content formats
  CONTENT_FORMATS,
  type ContentFormat,
  // Author types
  AUTHOR_TYPES,
  type AuthorType,
  AuthorTypes,
  // Event types
  EVENT_TYPES,
  type EventType,
  // Workspace roles
  WORKSPACE_MEMBER_ROLES,
  type WorkspaceMemberRole,
  // Persona
  PERSONA_MANAGED_BY,
  type PersonaManagedBy,
  PERSONA_STATUSES,
  type PersonaStatus,
} from "./constants"

// Domain entities (wire format)
export type { User, Workspace, WorkspaceMember, Stream, StreamMember, Message, StreamEvent, Persona } from "./domain"

// API types
export type {
  // Streams
  CreateStreamInput,
  UpdateStreamInput,
  UpdateCompanionModeInput,
  StreamBootstrap,
  // Messages
  CreateMessageInput,
  UpdateMessageInput,
  // Workspaces
  CreateWorkspaceInput,
  WorkspaceBootstrap,
} from "./api"
