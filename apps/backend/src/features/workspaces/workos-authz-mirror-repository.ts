import type { WorkspaceRole, WorkspacePermissionScope } from "@threa/types"
import type { WorkspaceAuthzSnapshot } from "@threa/types"
import type { Querier } from "../../db"
import { sql } from "../../db"
import { ADMIN_COMPATIBILITY_PERMISSIONS } from "../../middleware/authorization"

export interface WorkspaceAuthzStateRow {
  workspace_id: string
  workos_organization_id: string
  revision: string
}

export interface WorkspaceMembershipAssignment {
  organizationMembershipId: string
  workosUserId: string
  roleSlugs: string[]
}

interface WorkspaceRoleRow {
  slug: string
  name: string
  description: string | null
  permissions: string[]
  role_type: string
}

const ADMIN_PERMISSIONS = Array.from(ADMIN_COMPATIBILITY_PERMISSIONS)

function mapRole(row: WorkspaceRoleRow): WorkspaceRole {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    permissions: row.permissions as WorkspacePermissionScope[],
    type: row.role_type,
  }
}

export async function upsertMembershipRoles(params: {
  db: Querier
  workspaceId: string
  organizationMembershipId: string
  workosUserId: string
  roleSlugs: string[]
}): Promise<void> {
  const { db, workspaceId, organizationMembershipId, workosUserId, roleSlugs } = params

  await db.query(sql`
    INSERT INTO workos_workspace_memberships (workspace_id, organization_membership_id, workos_user_id)
    VALUES (${workspaceId}, ${organizationMembershipId}, ${workosUserId})
    ON CONFLICT (workspace_id, organization_membership_id)
    DO UPDATE SET workos_user_id = EXCLUDED.workos_user_id, updated_at = NOW()
  `)

  await db.query(sql`
    DELETE FROM workos_workspace_membership_roles
    WHERE workspace_id = ${workspaceId}
      AND organization_membership_id = ${organizationMembershipId}
  `)

  if (roleSlugs.length > 0) {
    const roleRows = roleSlugs.map((roleSlug, position) => ({
      role_slug: roleSlug,
      position,
    }))
    await db.query(sql`
      INSERT INTO workos_workspace_membership_roles (
        workspace_id,
        organization_membership_id,
        role_slug,
        position
      )
      SELECT
        ${workspaceId},
        ${organizationMembershipId},
        rows.role_slug,
        rows.position
      FROM jsonb_to_recordset(${JSON.stringify(roleRows)}::jsonb) AS rows(
        role_slug text,
        position integer
      )
    `)
  }
}

export const WorkosAuthzMirrorRepository = {
  async claimRoleMutationLease(params: {
    db: Querier
    workspaceId: string
    leaseId: string
    lockedUntil: Date
  }): Promise<boolean> {
    const result = await params.db.query(sql`
      INSERT INTO workspace_role_mutation_locks (workspace_id, lock_run_id, locked_until)
      VALUES (${params.workspaceId}, ${params.leaseId}, ${params.lockedUntil})
      ON CONFLICT (workspace_id) DO UPDATE
      SET lock_run_id = EXCLUDED.lock_run_id,
          locked_until = EXCLUDED.locked_until,
          updated_at = NOW()
      WHERE workspace_role_mutation_locks.locked_until <= NOW()
      RETURNING workspace_id
    `)
    return result.rows.length > 0
  },

  async releaseRoleMutationLease(db: Querier, workspaceId: string, leaseId: string): Promise<void> {
    await db.query(sql`
      DELETE FROM workspace_role_mutation_locks
      WHERE workspace_id = ${workspaceId}
        AND lock_run_id = ${leaseId}
    `)
  },

  async getState(db: Querier, workspaceId: string): Promise<WorkspaceAuthzStateRow | null> {
    const result = await db.query<WorkspaceAuthzStateRow>(sql`
      SELECT workspace_id, workos_organization_id, revision::text AS revision
      FROM workos_workspace_authz_state
      WHERE workspace_id = ${workspaceId}
    `)
    return result.rows[0] ?? null
  },

  async listRoles(db: Querier, workspaceId: string): Promise<WorkspaceRole[]> {
    const result = await db.query<WorkspaceRoleRow>(sql`
      SELECT slug, name, description, permissions, role_type
      FROM workos_workspace_roles
      WHERE workspace_id = ${workspaceId}
      ORDER BY name, slug
    `)
    return result.rows.map(mapRole)
  },

  async findMembershipAssignment(
    db: Querier,
    workspaceId: string,
    workosUserId: string
  ): Promise<WorkspaceMembershipAssignment | null> {
    const result = await db.query<{
      organization_membership_id: string
      workos_user_id: string
      role_slugs: string[] | null
    }>(sql`
      SELECT
        m.organization_membership_id,
        m.workos_user_id,
        ARRAY_REMOVE(ARRAY_AGG(mr.role_slug ORDER BY mr.position), NULL) AS role_slugs
      FROM workos_workspace_memberships m
      LEFT JOIN workos_workspace_membership_roles mr
        ON mr.workspace_id = m.workspace_id
       AND mr.organization_membership_id = m.organization_membership_id
      WHERE m.workspace_id = ${workspaceId}
        AND m.workos_user_id = ${workosUserId}
      GROUP BY m.organization_membership_id, m.workos_user_id
    `)
    const row = result.rows[0]
    if (!row) {
      return null
    }

    return {
      organizationMembershipId: row.organization_membership_id,
      workosUserId: row.workos_user_id,
      roleSlugs: row.role_slugs ?? [],
    }
  },

  async listMembershipAssignments(db: Querier, workspaceId: string): Promise<WorkspaceMembershipAssignment[]> {
    const result = await db.query<{
      organization_membership_id: string
      workos_user_id: string
      role_slugs: string[] | null
    }>(sql`
      SELECT
        m.organization_membership_id,
        m.workos_user_id,
        ARRAY_REMOVE(ARRAY_AGG(mr.role_slug ORDER BY mr.position), NULL) AS role_slugs
      FROM workos_workspace_memberships m
      LEFT JOIN workos_workspace_membership_roles mr
        ON mr.workspace_id = m.workspace_id
       AND mr.organization_membership_id = m.organization_membership_id
      WHERE m.workspace_id = ${workspaceId}
      GROUP BY m.organization_membership_id, m.workos_user_id
    `)

    return result.rows.map((row) => ({
      organizationMembershipId: row.organization_membership_id,
      workosUserId: row.workos_user_id,
      roleSlugs: row.role_slugs ?? [],
    }))
  },

  async hasOtherRoleManager(
    db: Querier,
    workspaceId: string,
    excludedOrganizationMembershipId: string
  ): Promise<boolean> {
    const result = await db.query(sql`
      SELECT 1
      FROM workos_workspace_memberships m
      WHERE m.workspace_id = ${workspaceId}
        AND m.organization_membership_id <> ${excludedOrganizationMembershipId}
        AND EXISTS (
          SELECT 1
          FROM workos_workspace_membership_roles mr
          JOIN workos_workspace_roles r
            ON r.workspace_id = mr.workspace_id
           AND r.slug = mr.role_slug
          WHERE mr.workspace_id = m.workspace_id
            AND mr.organization_membership_id = m.organization_membership_id
            AND r.permissions && ${ADMIN_PERMISSIONS}::text[]
        )
      LIMIT 1
    `)
    return result.rows.length > 0
  },

  upsertMembershipRoles,

  async syncCompatibilityRoles(db: Querier, workspaceId: string): Promise<void> {
    await db.query(sql`
      WITH resolved AS (
        SELECT
          u.id,
          CASE
            WHEN w.created_by = u.id AND u.role = 'owner' THEN 'owner'
            WHEN EXISTS (
              SELECT 1
              FROM workos_workspace_memberships m
              JOIN workos_workspace_membership_roles mr
                ON mr.workspace_id = m.workspace_id
               AND mr.organization_membership_id = m.organization_membership_id
              JOIN workos_workspace_roles r
                ON r.workspace_id = mr.workspace_id
               AND r.slug = mr.role_slug
              WHERE m.workspace_id = u.workspace_id
                AND m.workos_user_id = u.workos_user_id
                AND r.permissions && ${ADMIN_PERMISSIONS}::text[]
            ) THEN 'admin'
            ELSE 'user'
          END AS role
        FROM users u
        JOIN workspaces w
          ON w.id = u.workspace_id
        WHERE u.workspace_id = ${workspaceId}
      )
      UPDATE users AS u
      SET role = resolved.role
      FROM resolved
      WHERE u.id = resolved.id
        AND u.workspace_id = ${workspaceId}
        AND u.role <> resolved.role
    `)
  },

  async applySnapshot(db: Querier, snapshot: WorkspaceAuthzSnapshot): Promise<boolean> {
    const stateResult = await db.query(sql`
      INSERT INTO workos_workspace_authz_state (
        workspace_id,
        workos_organization_id,
        revision,
        updated_at
      )
      VALUES (
        ${snapshot.workspaceId},
        ${snapshot.workosOrganizationId},
        ${snapshot.revision}::bigint,
        NOW()
      )
      ON CONFLICT (workspace_id) DO UPDATE
      SET workos_organization_id = EXCLUDED.workos_organization_id,
          revision = EXCLUDED.revision,
          updated_at = NOW()
      WHERE workos_workspace_authz_state.revision < EXCLUDED.revision
    `)
    if ((stateResult.rowCount ?? 0) === 0) {
      return false
    }

    await db.query(sql`
      DELETE FROM workos_workspace_membership_roles
      WHERE workspace_id = ${snapshot.workspaceId}
    `)
    await db.query(sql`
      DELETE FROM workos_workspace_memberships
      WHERE workspace_id = ${snapshot.workspaceId}
    `)
    await db.query(sql`
      DELETE FROM workos_workspace_roles
      WHERE workspace_id = ${snapshot.workspaceId}
    `)

    if (snapshot.roles.length > 0) {
      await db.query(sql`
        INSERT INTO workos_workspace_roles (
          workspace_id,
          slug,
          name,
          description,
          permissions,
          role_type
        )
        SELECT
          ${snapshot.workspaceId},
          rows.slug,
          rows.name,
          rows.description,
          rows.permissions,
          rows.type
        FROM jsonb_to_recordset(${JSON.stringify(snapshot.roles)}::jsonb) AS rows(
          slug text,
          name text,
          description text,
          permissions text[],
          type text
        )
      `)
    }

    if (snapshot.memberships.length > 0) {
      const membershipRows = snapshot.memberships.map((membership) => ({
        organization_membership_id: membership.organizationMembershipId,
        workos_user_id: membership.workosUserId,
        role_slugs: membership.roleSlugs,
      }))
      await db.query(sql`
        INSERT INTO workos_workspace_memberships (
          workspace_id,
          organization_membership_id,
          workos_user_id
        )
        SELECT
          ${snapshot.workspaceId},
          rows.organization_membership_id,
          rows.workos_user_id
        FROM jsonb_to_recordset(${JSON.stringify(membershipRows)}::jsonb) AS rows(
          organization_membership_id text,
          workos_user_id text,
          role_slugs text[]
        )
      `)

      const membershipRoleRows = snapshot.memberships.flatMap((membership) =>
        membership.roleSlugs.map((roleSlug, position) => ({
          organization_membership_id: membership.organizationMembershipId,
          role_slug: roleSlug,
          position,
        }))
      )

      if (membershipRoleRows.length > 0) {
        await db.query(sql`
          INSERT INTO workos_workspace_membership_roles (
            workspace_id,
            organization_membership_id,
            role_slug,
            position
          )
          SELECT
            ${snapshot.workspaceId},
            rows.organization_membership_id,
            rows.role_slug,
            rows.position
          FROM jsonb_to_recordset(${JSON.stringify(membershipRoleRows)}::jsonb) AS rows(
            organization_membership_id text,
            role_slug text,
            position integer
          )
        `)
      }
    }

    return true
  },
}
