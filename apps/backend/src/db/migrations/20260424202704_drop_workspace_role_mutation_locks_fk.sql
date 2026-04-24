-- Relational integrity is enforced in application code, not in PostgreSQL
-- schema design (INV-1: no foreign keys). Drop the FK added in the previous
-- migration. Orphaned lease rows after a workspace is deleted are harmless:
-- any row whose locked_until is past is considered released, and the lease
-- is keyed on workspace_id so a recreated workspace with the same id would
-- simply acquire the stale entry via the existing ON CONFLICT path.

ALTER TABLE workspace_role_mutation_locks
    DROP CONSTRAINT IF EXISTS workspace_role_mutation_locks_workspace_id_fkey;
