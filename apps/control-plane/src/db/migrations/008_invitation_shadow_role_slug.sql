-- Workspace role applied when CP sends the WorkOS invitation and when
-- materializing the organization membership on accept. The 'member' default
-- exists so legacy rows (inserted before this column existed) stay valid.

ALTER TABLE invitation_shadows
  ADD COLUMN role_slug TEXT NOT NULL DEFAULT 'member';
