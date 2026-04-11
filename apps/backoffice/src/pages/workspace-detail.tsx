import { type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "react-router-dom"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/layout/page-header"
import { Section } from "@/components/layout/section"
import { backofficeKeys, getWorkspace, type WorkspaceDetail } from "@/api/backoffice"
import { ApiError } from "@/api/client"

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const query = useQuery({
    queryKey: id ? backofficeKeys.workspace(id) : ["backoffice", "workspaces", "missing"],
    queryFn: () => {
      if (!id) throw new Error("Missing workspace id")
      return getWorkspace(id)
    },
    enabled: !!id,
  })

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/workspaces">
            <ChevronLeft className="size-4" />
            Back to workspaces
          </Link>
        </Button>
      </div>

      <WorkspaceDetailBody loading={query.isLoading} error={query.error} workspace={query.data} />
    </div>
  )
}

function WorkspaceDetailBody({
  loading,
  error,
  workspace,
}: {
  loading: boolean
  error: unknown
  workspace: WorkspaceDetail | undefined
}) {
  if (loading) {
    return <div className="border-y px-1 py-10 text-center text-sm text-muted-foreground">Loading workspace…</div>
  }

  if (error) {
    const notFound = ApiError.isApiError(error) && error.status === 404
    return (
      <div className="border-y px-1 py-10 text-center text-sm text-muted-foreground">
        {notFound ? "That workspace doesn't exist." : "Couldn't load workspace."}
      </div>
    )
  }

  if (!workspace) return null

  return (
    <div className="flex flex-col gap-10">
      <PageHeader title={workspace.name} description={`@${workspace.slug}`} />

      <Section label="Owner">
        <FieldGrid>
          <Field label="Name" value={workspace.owner.name ?? "Unknown"} />
          <Field
            label="Email"
            value={
              workspace.owner.email ? (
                <span className="break-words">{workspace.owner.email}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
          />
          <Field
            label="WorkOS user"
            value={<span className="break-all font-mono text-xs">{workspace.owner.workosUserId}</span>}
            span={2}
          />
        </FieldGrid>
      </Section>

      <Section label="Details">
        <FieldGrid>
          <Field
            label="Workspace id"
            value={<span className="break-all font-mono text-xs">{workspace.id}</span>}
            span={2}
          />
          <Field label="Region" value={workspace.region} />
          <Field label="Members" value={workspace.memberCount.toString()} />
          <Field
            label="WorkOS organization"
            value={
              workspace.workosOrganizationId ? (
                <span className="break-all font-mono text-xs">{workspace.workosOrganizationId}</span>
              ) : (
                <span className="text-muted-foreground">Not linked</span>
              )
            }
            span={2}
          />
          <Field label="Created" value={formatDateTime(workspace.createdAt)} />
          <Field label="Updated" value={formatDateTime(workspace.updatedAt)} />
        </FieldGrid>
      </Section>
    </div>
  )
}

function FieldGrid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-1 gap-x-8 gap-y-5 border-t pt-5 sm:grid-cols-2">{children}</dl>
}

function Field({ label, value, span = 1 }: { label: string; value: ReactNode; span?: 1 | 2 }) {
  return (
    <div className={span === 2 ? "flex flex-col gap-1.5 sm:col-span-2" : "flex flex-col gap-1.5"}>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  )
}
