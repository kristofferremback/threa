import type { Querier } from "../../db"
import { sql } from "../../db"
const DM_UNIQUENESS_KEY_PREFIX = "dm"

export interface DmPeer {
  memberId: string
  streamId: string
}

export function normalizeDmMemberPair(
  memberOneId: string,
  memberTwoId: string
): { memberAId: string; memberBId: string } {
  return memberOneId < memberTwoId
    ? { memberAId: memberOneId, memberBId: memberTwoId }
    : { memberAId: memberTwoId, memberBId: memberOneId }
}

export function buildDmUniquenessKey(memberOneId: string, memberTwoId: string): string {
  const { memberAId, memberBId } = normalizeDmMemberPair(memberOneId, memberTwoId)
  return `${DM_UNIQUENESS_KEY_PREFIX}:${memberAId}:${memberBId}`
}

export const DmPairRepository = {
  async listPeersForMember(db: Querier, workspaceId: string, memberId: string): Promise<DmPeer[]> {
    const result = await db.query<{ stream_id: string; member_id: string }>(sql`
      WITH dm_members AS (
        SELECT
          sm.stream_id,
          array_agg(DISTINCT sm.member_id ORDER BY sm.member_id) AS member_ids
        FROM stream_members sm
        JOIN streams s ON s.id = sm.stream_id
        WHERE s.workspace_id = ${workspaceId}
          AND s.type = 'dm'
          AND s.archived_at IS NULL
        GROUP BY sm.stream_id
        HAVING COUNT(DISTINCT sm.member_id) = 2
          AND bool_or(sm.member_id = ${memberId})
      )
      SELECT
        stream_id,
        CASE
          WHEN member_ids[1] = ${memberId} THEN member_ids[2]
          ELSE member_ids[1]
        END AS member_id
      FROM dm_members
    `)

    return result.rows.map((row) => ({
      memberId: row.member_id,
      streamId: row.stream_id,
    }))
  },
}
