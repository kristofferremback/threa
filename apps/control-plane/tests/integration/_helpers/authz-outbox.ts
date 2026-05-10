import type { Pool } from "pg"
import { OUTBOX_AUTHZ_MEMBERSHIP_CHANGED, OUTBOX_AUTHZ_MEMBERSHIP_REMOVED } from "../../../src/features/workos-authz"

const AUTHZ_EVENT_TYPES = [OUTBOX_AUTHZ_MEMBERSHIP_CHANGED, OUTBOX_AUTHZ_MEMBERSHIP_REMOVED]

export interface AuthzOutboxRow {
  event_type: string
  payload: Record<string, unknown>
}

export async function fetchAuthzOutbox(pool: Pool, orgId: string): Promise<AuthzOutboxRow[]> {
  const result = await pool.query<AuthzOutboxRow>(
    `SELECT event_type, payload FROM outbox
     WHERE event_type = ANY($1::text[])
       AND payload->>'workosOrganizationId' = $2
     ORDER BY id ASC`,
    [AUTHZ_EVENT_TYPES, orgId]
  )
  return result.rows
}

export async function cleanupAuthzOutbox(pool: Pool, orgId: string): Promise<void> {
  await pool.query(
    `DELETE FROM outbox WHERE event_type = ANY($1::text[])
       AND payload->>'workosOrganizationId' = $2`,
    [AUTHZ_EVENT_TYPES, orgId]
  )
}
