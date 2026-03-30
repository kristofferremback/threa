import { UserApiKeysSection } from "./user-api-keys-section"

interface ApiKeysTabProps {
  workspaceId: string
}

export function ApiKeysTab({ workspaceId }: ApiKeysTabProps) {
  return (
    <div className="space-y-6 p-1">
      <section>
        <div className="mb-3">
          <h3 className="text-sm font-medium">Personal keys</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            These keys act as you — same permissions, same stream access.
          </p>
        </div>
        <UserApiKeysSection workspaceId={workspaceId} />
      </section>
    </div>
  )
}
