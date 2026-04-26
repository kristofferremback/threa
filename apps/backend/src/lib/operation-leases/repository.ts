import { ulid } from "ulid"
import type { Querier } from "../../db"
import { sql } from "../../db"

export interface OperationLease {
  id: string
  workspaceId: string
  userId: string
  operationType: string
  payload: Record<string, unknown>
  expiresAt: Date
  consumedAt: Date | null
  createdAt: Date
}

interface OperationLeaseRow {
  id: string
  workspace_id: string
  user_id: string
  operation_type: string
  payload: Record<string, unknown>
  expires_at: Date
  consumed_at: Date | null
  created_at: Date
}

function mapRow(row: OperationLeaseRow): OperationLease {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    operationType: row.operation_type,
    payload: row.payload,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
  }
}

const SELECT_FIELDS = "id, workspace_id, user_id, operation_type, payload, expires_at, consumed_at, created_at"

export const OperationLeaseRepository = {
  async create(
    db: Querier,
    params: {
      workspaceId: string
      userId: string
      operationType: string
      payload: Record<string, unknown>
      ttlSeconds?: number
    }
  ): Promise<OperationLease> {
    const id = `lease_${ulid()}`
    const ttlSeconds = params.ttlSeconds ?? 300
    const result = await db.query<OperationLeaseRow>(sql`
      INSERT INTO batch_operation_leases (id, workspace_id, user_id, operation_type, payload, expires_at)
      VALUES (
        ${id},
        ${params.workspaceId},
        ${params.userId},
        ${params.operationType},
        ${JSON.stringify(params.payload)},
        NOW() + INTERVAL '1 second' * ${ttlSeconds}
      )
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return mapRow(result.rows[0])
  },

  async consume(
    db: Querier,
    params: {
      id: string
      workspaceId: string
      userId: string
      operationType: string
    }
  ): Promise<OperationLease | null> {
    const result = await db.query<OperationLeaseRow>(sql`
      UPDATE batch_operation_leases
      SET consumed_at = NOW()
      WHERE id = ${params.id}
        AND workspace_id = ${params.workspaceId}
        AND user_id = ${params.userId}
        AND operation_type = ${params.operationType}
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING ${sql.raw(SELECT_FIELDS)}
    `)
    return result.rows[0] ? mapRow(result.rows[0]) : null
  },
}
