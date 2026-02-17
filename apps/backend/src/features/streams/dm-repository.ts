import type { Querier } from "../../db"
import { sql } from "../../db"

interface DmPairRow {
  stream_id: string
  workspace_id: string
  member_a_id: string
  member_b_id: string
  created_at: Date
}

export interface DmPair {
  streamId: string
  workspaceId: string
  memberAId: string
  memberBId: string
  createdAt: Date
}

export interface DmPeer {
  memberId: string
  streamId: string
}

function mapRowToDmPair(row: DmPairRow): DmPair {
  return {
    streamId: row.stream_id,
    workspaceId: row.workspace_id,
    memberAId: row.member_a_id,
    memberBId: row.member_b_id,
    createdAt: row.created_at,
  }
}

export function normalizeDmMemberPair(
  memberOneId: string,
  memberTwoId: string
): { memberAId: string; memberBId: string } {
  return memberOneId < memberTwoId
    ? { memberAId: memberOneId, memberBId: memberTwoId }
    : { memberAId: memberTwoId, memberBId: memberOneId }
}

export const DmPairRepository = {
  async findByMembers(
    db: Querier,
    workspaceId: string,
    memberOneId: string,
    memberTwoId: string
  ): Promise<DmPair | null> {
    const { memberAId, memberBId } = normalizeDmMemberPair(memberOneId, memberTwoId)

    const result = await db.query<DmPairRow>(sql`
      SELECT stream_id, workspace_id, member_a_id, member_b_id, created_at
      FROM dm_pairs
      WHERE workspace_id = ${workspaceId}
        AND member_a_id = ${memberAId}
        AND member_b_id = ${memberBId}
      LIMIT 1
    `)

    return result.rows[0] ? mapRowToDmPair(result.rows[0]) : null
  },

  async insert(
    db: Querier,
    params: { streamId: string; workspaceId: string; memberOneId: string; memberTwoId: string }
  ): Promise<DmPair> {
    const { memberAId, memberBId } = normalizeDmMemberPair(params.memberOneId, params.memberTwoId)

    const result = await db.query<DmPairRow>(sql`
      INSERT INTO dm_pairs (stream_id, workspace_id, member_a_id, member_b_id)
      VALUES (${params.streamId}, ${params.workspaceId}, ${memberAId}, ${memberBId})
      RETURNING stream_id, workspace_id, member_a_id, member_b_id, created_at
    `)

    return mapRowToDmPair(result.rows[0])
  },

  async listPeersForMember(db: Querier, workspaceId: string, memberId: string): Promise<DmPeer[]> {
    const result = await db.query<{ stream_id: string; member_id: string }>(sql`
      SELECT
        dp.stream_id,
        CASE
          WHEN dp.member_a_id = ${memberId} THEN dp.member_b_id
          ELSE dp.member_a_id
        END AS member_id
      FROM dm_pairs dp
      JOIN streams s ON s.id = dp.stream_id
      WHERE dp.workspace_id = ${workspaceId}
        AND s.archived_at IS NULL
        AND (dp.member_a_id = ${memberId} OR dp.member_b_id = ${memberId})
    `)

    return result.rows.map((row) => ({
      memberId: row.member_id,
      streamId: row.stream_id,
    }))
  },
}
