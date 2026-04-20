import type { WorkspaceAuthzSnapshot, WorkspaceRole } from "@threa/types"
import type { Querier } from "@threa/backend-common"

interface WorkspaceRoleRow {
  slug: string
  name: string
  description: string | null
  permissions: string[]
  role_type: string
}

function mapRole(row: WorkspaceRoleRow): WorkspaceRole {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    permissions: row.permissions as WorkspaceRole["permissions"],
    type: row.role_type,
  }
}

export const ControlPlaneAuthzMirrorRepository = {
  async tryAcquireLease(
    db: Querier,
    scope: string,
    leaseOwner: string,
    leaseUntil: Date
  ): Promise<{ cursor: string | null } | null> {
    const result = await db.query<{ cursor: string | null }>(
      `INSERT INTO workos_authz_sync_state (scope, cursor, lease_owner, locked_until, updated_at)
       VALUES ($1, NULL, $2, $3, NOW())
       ON CONFLICT (scope) DO UPDATE
       SET lease_owner = EXCLUDED.lease_owner,
           locked_until = EXCLUDED.locked_until,
           updated_at = NOW()
       WHERE workos_authz_sync_state.locked_until IS NULL
          OR workos_authz_sync_state.locked_until < NOW()
          OR workos_authz_sync_state.lease_owner = EXCLUDED.lease_owner
       RETURNING cursor`,
      [scope, leaseOwner, leaseUntil]
    )
    const row = result.rows[0]
    return row ? { cursor: row.cursor } : null
  },

  async releaseLease(db: Querier, scope: string, leaseOwner: string, cursor: string | null): Promise<void> {
    await db.query(
      `UPDATE workos_authz_sync_state
       SET cursor = $3,
           lease_owner = NULL,
           locked_until = NULL,
           last_run_at = NOW(),
           updated_at = NOW()
       WHERE scope = $1 AND lease_owner = $2`,
      [scope, leaseOwner, cursor]
    )
  },

  async recordEvent(
    db: Querier,
    params: {
      eventId: string
      eventType: string
      organizationId: string | null
      workspaceId: string | null
      status: string
      occurredAt: string
      payload: Record<string, unknown>
    }
  ): Promise<boolean> {
    const result = await db.query(
      `INSERT INTO workos_authz_event_log (
         event_id,
         event_type,
         organization_id,
         workspace_id,
         status,
         occurred_at,
         payload
       )
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        params.eventId,
        params.eventType,
        params.organizationId,
        params.workspaceId,
        params.status,
        params.occurredAt,
        JSON.stringify(params.payload),
      ]
    )
    return (result.rowCount ?? 0) > 0
  },

  async hasRecordedEvent(db: Querier, eventId: string): Promise<boolean> {
    const result = await db.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1
         FROM workos_authz_event_log
         WHERE event_id = $1
       ) AS exists`,
      [eventId]
    )
    return result.rows[0]?.exists ?? false
  },

  async replaceSnapshot(
    db: Querier,
    params: Omit<WorkspaceAuthzSnapshot, "revision" | "generatedAt">
  ): Promise<string> {
    const stateResult = await db.query<{ revision: string }>(
      `INSERT INTO workos_workspace_authz_state (
         workspace_id,
         workos_organization_id,
         revision,
         updated_at
       )
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (workspace_id) DO UPDATE
       SET workos_organization_id = EXCLUDED.workos_organization_id,
           revision = workos_workspace_authz_state.revision + 1,
           updated_at = NOW()
       RETURNING revision::text AS revision`,
      [params.workspaceId, params.workosOrganizationId]
    )
    const revision = stateResult.rows[0]?.revision
    if (!revision) {
      throw new Error(`Failed to update canonical authz mirror revision for workspace ${params.workspaceId}`)
    }

    await db.query(`DELETE FROM workos_workspace_membership_roles WHERE workspace_id = $1`, [params.workspaceId])
    await db.query(`DELETE FROM workos_workspace_memberships WHERE workspace_id = $1`, [params.workspaceId])
    await db.query(`DELETE FROM workos_workspace_roles WHERE workspace_id = $1`, [params.workspaceId])

    if (params.roles.length > 0) {
      const roleValues = params.roles.flatMap((role) => [
        params.workspaceId,
        role.slug,
        role.name,
        role.description,
        role.permissions,
        role.type,
      ])
      const placeholders = params.roles
        .map(
          (_, index) =>
            `($${index * 6 + 1}, $${index * 6 + 2}, $${index * 6 + 3}, $${index * 6 + 4}, $${index * 6 + 5}::text[], $${index * 6 + 6})`
        )
        .join(", ")
      await db.query(
        `INSERT INTO workos_workspace_roles (
           workspace_id,
           slug,
           name,
           description,
           permissions,
           role_type
         ) VALUES ${placeholders}`,
        roleValues
      )
    }

    if (params.memberships.length > 0) {
      const membershipValues = params.memberships.flatMap((membership) => [
        params.workspaceId,
        membership.organizationMembershipId,
        membership.workosUserId,
      ])
      const membershipPlaceholders = params.memberships
        .map((_, index) => `($${index * 3 + 1}, $${index * 3 + 2}, $${index * 3 + 3})`)
        .join(", ")
      await db.query(
        `INSERT INTO workos_workspace_memberships (
           workspace_id,
           organization_membership_id,
           workos_user_id
         ) VALUES ${membershipPlaceholders}`,
        membershipValues
      )

      const membershipRoles = params.memberships.flatMap((membership) =>
        membership.roleSlugs.map((roleSlug, position) => [
          params.workspaceId,
          membership.organizationMembershipId,
          roleSlug,
          position,
        ])
      )
      if (membershipRoles.length > 0) {
        const rolePlaceholders = membershipRoles
          .map((_, index) => `($${index * 4 + 1}, $${index * 4 + 2}, $${index * 4 + 3}, $${index * 4 + 4})`)
          .join(", ")
        await db.query(
          `INSERT INTO workos_workspace_membership_roles (
             workspace_id,
             organization_membership_id,
             role_slug,
             position
           ) VALUES ${rolePlaceholders}`,
          membershipRoles.flat()
        )
      }
    }

    return revision
  },

  async getSnapshot(db: Querier, workspaceId: string): Promise<WorkspaceAuthzSnapshot | null> {
    const stateResult = await db.query<{
      workos_organization_id: string
      revision: string
      updated_at: Date
    }>(
      `SELECT workos_organization_id, revision::text AS revision, updated_at
       FROM workos_workspace_authz_state
       WHERE workspace_id = $1`,
      [workspaceId]
    )
    const state = stateResult.rows[0]
    if (!state) {
      return null
    }

    const [rolesResult, membershipsResult] = await Promise.all([
      db.query<WorkspaceRoleRow>(
        `SELECT slug, name, description, permissions, role_type
         FROM workos_workspace_roles
         WHERE workspace_id = $1
         ORDER BY name, slug`,
        [workspaceId]
      ),
      db.query<{
        organization_membership_id: string
        workos_user_id: string
        role_slugs: string[] | null
      }>(
        `SELECT
           m.organization_membership_id,
           m.workos_user_id,
           ARRAY_REMOVE(ARRAY_AGG(mr.role_slug ORDER BY mr.position), NULL) AS role_slugs
         FROM workos_workspace_memberships m
         LEFT JOIN workos_workspace_membership_roles mr
           ON mr.workspace_id = m.workspace_id
          AND mr.organization_membership_id = m.organization_membership_id
         WHERE m.workspace_id = $1
         GROUP BY m.organization_membership_id, m.workos_user_id`,
        [workspaceId]
      ),
    ])

    return {
      workspaceId,
      workosOrganizationId: state.workos_organization_id,
      revision: state.revision,
      generatedAt: state.updated_at.toISOString(),
      roles: rolesResult.rows.map(mapRole),
      memberships: membershipsResult.rows.map((row) => ({
        organizationMembershipId: row.organization_membership_id,
        workosUserId: row.workos_user_id,
        roleSlugs: row.role_slugs ?? [],
      })),
    }
  },
}
