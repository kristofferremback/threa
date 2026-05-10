-- Index supporting the regional authz fan-out lookup
-- (`WorkspaceRegistryRepository.listByWorkosOrganizationId`).
-- Partial index: most rows have a workos_organization_id, but legacy/in-flight
-- rows may not — exclude them so the index stays tight.

CREATE INDEX idx_workspace_registry_workos_org
    ON workspace_registry (workos_organization_id)
    WHERE workos_organization_id IS NOT NULL;
