-- Fix existing workspace creators to be owners
-- The first member of each workspace is assumed to be the creator
UPDATE workspace_members wm
SET role = 'owner'
WHERE wm.user_id = (
    SELECT user_id
    FROM workspace_members wm2
    WHERE wm2.workspace_id = wm.workspace_id
    ORDER BY joined_at ASC
    LIMIT 1
)
AND wm.role != 'owner';

-- For existing channel memberships without a role, set to 'member'
-- (The DEFAULT should handle this, but just in case)
UPDATE channel_members
SET role = 'member'
WHERE role IS NULL;

