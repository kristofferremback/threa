import { Unlink, ShieldX } from "lucide-react"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty"

interface StreamErrorViewProps {
  type: "not-found" | "forbidden"
}

export function StreamErrorView({ type }: StreamErrorViewProps) {
  if (type === "forbidden") {
    return (
      <Empty className="h-full border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ShieldX />
          </EmptyMedia>
          <EmptyTitle>Access Denied</EmptyTitle>
          <EmptyDescription>
            You don&apos;t have permission to view this stream. The path exists, but the gates are closed to you.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Unlink />
        </EmptyMedia>
        <EmptyTitle>The Thread Has Broken</EmptyTitle>
        <EmptyDescription>
          The path you seek has faded into the labyrinth. Perhaps the stream was archived, or the thread was never spun.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
