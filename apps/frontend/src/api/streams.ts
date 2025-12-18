import { api } from "./client"
import type {
  Stream,
  StreamMember,
  StreamEvent,
  StreamType,
  Visibility,
  CompanionMode,
} from "@/types/domain"

// Bootstrap response - everything needed to render a stream
export interface StreamBootstrap {
  stream: Stream
  events: StreamEvent[]
  members: StreamMember[]
  membership: StreamMember | null
  latestSequence: string
}

export interface CreateStreamInput {
  type: StreamType
  displayName?: string
  slug?: string
  description?: string
  visibility?: Visibility
  companionMode?: CompanionMode
  companionPersonaId?: string
}

export interface UpdateStreamInput {
  displayName?: string
  description?: string
  visibility?: Visibility
  companionMode?: CompanionMode
  companionPersonaId?: string
}

export const streamsApi = {
  async list(workspaceId: string, params?: { type?: StreamType }): Promise<Stream[]> {
    const searchParams = new URLSearchParams()
    if (params?.type) searchParams.set("stream_type", params.type)
    const query = searchParams.toString()
    const res = await api.get<{ streams: Stream[] }>(
      `/api/workspaces/${workspaceId}/streams${query ? `?${query}` : ""}`,
    )
    return res.streams
  },

  async get(workspaceId: string, streamId: string): Promise<Stream> {
    const res = await api.get<{ stream: Stream }>(
      `/api/workspaces/${workspaceId}/streams/${streamId}`,
    )
    return res.stream
  },

  async bootstrap(workspaceId: string, streamId: string): Promise<StreamBootstrap> {
    const res = await api.get<{ data: StreamBootstrap }>(
      `/api/workspaces/${workspaceId}/streams/${streamId}/bootstrap`,
    )
    return res.data
  },

  async create(workspaceId: string, data: CreateStreamInput): Promise<Stream> {
    const res = await api.post<{ stream: Stream }>(
      `/api/workspaces/${workspaceId}/streams`,
      data,
    )
    return res.stream
  },

  async update(workspaceId: string, streamId: string, data: UpdateStreamInput): Promise<Stream> {
    const res = await api.patch<{ stream: Stream }>(
      `/api/workspaces/${workspaceId}/streams/${streamId}`,
      data,
    )
    return res.stream
  },

  archive(workspaceId: string, streamId: string): Promise<void> {
    return api.post(`/api/workspaces/${workspaceId}/streams/${streamId}/archive`)
  },

  // Event fetching for pagination
  async getEvents(
    workspaceId: string,
    streamId: string,
    params?: { before?: string; limit?: number },
  ): Promise<StreamEvent[]> {
    const searchParams = new URLSearchParams()
    if (params?.before) searchParams.set("after", params.before)
    if (params?.limit) searchParams.set("limit", params.limit.toString())
    const query = searchParams.toString()
    const res = await api.get<{ events: StreamEvent[] }>(
      `/api/workspaces/${workspaceId}/streams/${streamId}/events${query ? `?${query}` : ""}`,
    )
    return res.events
  },
}
