import type { Querier } from "@threa/backend-common"

export interface WorkosOrgMembershipRow {
  workos_organization_id: string
  workos_user_id: string
  organization_membership_id: string
  status: string
  role_slugs: string[]
  last_event_id: string | null
  last_event_at: Date
  created_at: Date
  updated_at: Date
}

export interface UpsertMembershipFromEventInput {
  organizationMembershipId: string
  workosOrganizationId: string
  workosUserId: string
  status: string
  roleSlugs: string[]
  eventId: string
  eventCreatedAt: Date
}

export interface UpsertMembershipFromBackfillInput {
  organizationMembershipId: string
  workosOrganizationId: string
  workosUserId: string
  status: string
  roleSlugs: string[]
  /** Stamped onto last_event_at; backfill is last-write-wins. */
  observedAt: Date
}

const SELECT_FIELDS = `
  workos_organization_id,
  workos_user_id,
  organization_membership_id,
  status,
  role_slugs,
  last_event_id,
  last_event_at,
  created_at,
  updated_at
`

export const WorkosAuthzRepository = {
  /**
   * Race-safe upsert from a WorkOS event (INV-20). A `last_event_at` timestamp
   * guard rejects stale or duplicated events: we only overwrite when the
   * incoming event is strictly newer than what we've already persisted.
   * Returns the row only when an actual change was applied — useful for
   * tests and metrics.
   */
  async upsertMembershipFromEvent(
    db: Querier,
    input: UpsertMembershipFromEventInput
  ): Promise<WorkosOrgMembershipRow | null> {
    const result = await db.query<WorkosOrgMembershipRow>(
      `INSERT INTO workos_organization_memberships (
         workos_organization_id,
         workos_user_id,
         organization_membership_id,
         status,
         role_slugs,
         last_event_id,
         last_event_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (workos_organization_id, workos_user_id) DO UPDATE SET
         organization_membership_id = EXCLUDED.organization_membership_id,
         status = EXCLUDED.status,
         role_slugs = EXCLUDED.role_slugs,
         last_event_id = EXCLUDED.last_event_id,
         last_event_at = EXCLUDED.last_event_at,
         updated_at = NOW()
       WHERE workos_organization_memberships.last_event_at < EXCLUDED.last_event_at
       RETURNING ${SELECT_FIELDS}`,
      [
        input.workosOrganizationId,
        input.workosUserId,
        input.organizationMembershipId,
        input.status,
        input.roleSlugs,
        input.eventId,
        input.eventCreatedAt,
      ]
    )
    return result.rows[0] ?? null
  },

  /**
   * Backfill upsert: last-write-wins, no timestamp guard. The operator running
   * backfill is the source of truth for that moment. Stamps `last_event_id`
   * to NULL so a subsequent event-driven update can compare timestamps cleanly.
   */
  async upsertMembershipFromBackfill(
    db: Querier,
    input: UpsertMembershipFromBackfillInput
  ): Promise<WorkosOrgMembershipRow> {
    const result = await db.query<WorkosOrgMembershipRow>(
      `INSERT INTO workos_organization_memberships (
         workos_organization_id,
         workos_user_id,
         organization_membership_id,
         status,
         role_slugs,
         last_event_id,
         last_event_at
       )
       VALUES ($1, $2, $3, $4, $5, NULL, $6)
       ON CONFLICT (workos_organization_id, workos_user_id) DO UPDATE SET
         organization_membership_id = EXCLUDED.organization_membership_id,
         status = EXCLUDED.status,
         role_slugs = EXCLUDED.role_slugs,
         last_event_id = NULL,
         last_event_at = EXCLUDED.last_event_at,
         updated_at = NOW()
       RETURNING ${SELECT_FIELDS}`,
      [
        input.workosOrganizationId,
        input.workosUserId,
        input.organizationMembershipId,
        input.status,
        input.roleSlugs,
        input.observedAt,
      ]
    )
    return result.rows[0]
  },

  /**
   * Delete with the same timestamp guard as upsert (INV-20). Only removes the
   * row when the deletion event is newer than the persisted state.
   */
  async deleteMembership(
    db: Querier,
    params: { workosOrganizationId: string; workosUserId: string; eventCreatedAt: Date }
  ): Promise<boolean> {
    const result = await db.query(
      `DELETE FROM workos_organization_memberships
       WHERE workos_organization_id = $1
         AND workos_user_id = $2
         AND last_event_at < $3`,
      [params.workosOrganizationId, params.workosUserId, params.eventCreatedAt]
    )
    return (result.rowCount ?? 0) > 0
  },

  async listByOrganization(db: Querier, workosOrganizationId: string): Promise<WorkosOrgMembershipRow[]> {
    const result = await db.query<WorkosOrgMembershipRow>(
      `SELECT ${SELECT_FIELDS}
       FROM workos_organization_memberships
       WHERE workos_organization_id = $1
       ORDER BY created_at ASC`,
      [workosOrganizationId]
    )
    return result.rows
  },

  async getByOrgAndUser(
    db: Querier,
    workosOrganizationId: string,
    workosUserId: string
  ): Promise<WorkosOrgMembershipRow | null> {
    const result = await db.query<WorkosOrgMembershipRow>(
      `SELECT ${SELECT_FIELDS}
       FROM workos_organization_memberships
       WHERE workos_organization_id = $1 AND workos_user_id = $2`,
      [workosOrganizationId, workosUserId]
    )
    return result.rows[0] ?? null
  },
}
