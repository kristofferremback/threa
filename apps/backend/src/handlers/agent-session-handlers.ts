import type { Request, Response } from "express"
import type { Pool } from "pg"
import { withClient } from "../db"
import { AgentSessionRepository } from "../repositories/agent-session-repository"
import { StreamRepository } from "../repositories/stream-repository"
import { StreamMemberRepository } from "../repositories/stream-member-repository"
import { PersonaRepository } from "../repositories/persona-repository"
import type { AgentSessionWithSteps, AgentStepType } from "@threa/types"

interface Dependencies {
  pool: Pool
}

export function createAgentSessionHandlers({ pool }: Dependencies) {
  return {
    /**
     * GET /api/workspaces/:workspaceId/agent-sessions/:sessionId
     *
     * Returns the agent session with its steps and persona info.
     * User must have access to the session's stream.
     */
    async getSession(req: Request, res: Response) {
      const userId = req.userId!
      const workspaceId = req.workspaceId!
      const { sessionId } = req.params

      const result = await withClient(pool, async (db) => {
        // Find the session
        const session = await AgentSessionRepository.findById(db, sessionId)
        if (!session) {
          return { error: "Session not found", status: 404 }
        }

        // Get the stream to check access and workspace
        const stream = await StreamRepository.findById(db, session.streamId)
        if (!stream || stream.workspaceId !== workspaceId) {
          return { error: "Session not found", status: 404 }
        }

        // Check if user has access to the stream
        const membership = await StreamMemberRepository.findByStreamAndUser(db, session.streamId, userId)
        if (!membership) {
          return { error: "Not authorized to view this session", status: 403 }
        }

        // Get the persona
        const persona = await PersonaRepository.findById(db, session.personaId)
        if (!persona) {
          return { error: "Persona not found", status: 404 }
        }

        // Get all steps for the session
        const steps = await AgentSessionRepository.findStepsBySession(db, sessionId)

        // Calculate duration if session is completed
        const duration =
          session.completedAt && session.createdAt ? session.completedAt.getTime() - session.createdAt.getTime() : null

        const response: AgentSessionWithSteps = {
          session: {
            id: session.id,
            streamId: session.streamId,
            personaId: session.personaId,
            triggerMessageId: session.triggerMessageId,
            status: session.status,
            currentStepType: session.currentStepType as AgentStepType | undefined,
            sentMessageIds: session.sentMessageIds,
            createdAt: session.createdAt.toISOString(),
            completedAt: session.completedAt?.toISOString(),
          },
          steps: steps.map((step) => ({
            id: step.id,
            sessionId: step.sessionId,
            stepNumber: step.stepNumber,
            stepType: step.stepType,
            content: step.content as string | undefined,
            sources: step.sources ?? undefined,
            tokensUsed: step.tokensUsed ?? undefined,
            duration:
              step.completedAt && step.startedAt ? step.completedAt.getTime() - step.startedAt.getTime() : undefined,
            startedAt: step.startedAt.toISOString(),
            completedAt: step.completedAt?.toISOString(),
          })),
          persona: {
            id: persona.id,
            name: persona.name,
            avatarUrl: null, // Personas use avatarEmoji, not URL
            avatarEmoji: persona.avatarEmoji,
          },
        }

        return { data: response }
      })

      if (result.error) {
        return res.status(result.status).json({ error: result.error })
      }

      res.json(result.data)
    },
  }
}
