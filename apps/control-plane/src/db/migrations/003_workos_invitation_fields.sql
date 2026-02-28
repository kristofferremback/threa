ALTER TABLE workspace_registry ADD COLUMN workos_organization_id TEXT;
ALTER TABLE invitation_shadows ADD COLUMN workos_invitation_id TEXT;
ALTER TABLE invitation_shadows ADD COLUMN inviter_workos_user_id TEXT;
