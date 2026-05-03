import { Image as ImageIcon, Film, FileText, FileType, FileSpreadsheet, File } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Toggle } from "@/components/ui/toggle"
import { cn } from "@/lib/utils"
import { AssetKinds, type AssetKind } from "@threa/types"
import { initialAssetFilters, type AssetExplorerFilters } from "./use-asset-explorer"

interface AssetFiltersProps {
  filters: AssetExplorerFilters
  onChange: (next: AssetExplorerFilters) => void
}

const KIND_OPTIONS: { kind: AssetKind; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { kind: AssetKinds.IMAGE, label: "Images", Icon: ImageIcon },
  { kind: AssetKinds.VIDEO, label: "Videos", Icon: Film },
  { kind: AssetKinds.PDF, label: "PDFs", Icon: FileText },
  { kind: AssetKinds.DOCUMENT, label: "Documents", Icon: FileType },
  { kind: AssetKinds.SPREADSHEET, label: "Spreadsheets", Icon: FileSpreadsheet },
  { kind: AssetKinds.TEXT, label: "Text", Icon: FileText },
  { kind: AssetKinds.OTHER, label: "Other", Icon: File },
]

export function AssetFilters({ filters, onChange }: AssetFiltersProps) {
  const toggleKind = (kind: AssetKind) => {
    const next = filters.mimeGroups.includes(kind)
      ? filters.mimeGroups.filter((k) => k !== kind)
      : [...filters.mimeGroups, kind]
    onChange({ ...filters, mimeGroups: next })
  }

  const setBefore = (v: string) => onChange({ ...filters, before: v ? new Date(v).toISOString() : null })
  const setAfter = (v: string) => onChange({ ...filters, after: v ? new Date(v).toISOString() : null })

  const hasFilters =
    filters.mimeGroups.length > 0 ||
    filters.uploadedBy !== null ||
    filters.before !== null ||
    filters.after !== null ||
    filters.exact ||
    filters.query.length > 0

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {KIND_OPTIONS.map(({ kind, label, Icon }) => {
          const active = filters.mimeGroups.includes(kind)
          return (
            <Toggle
              key={kind}
              size="sm"
              pressed={active}
              onPressedChange={() => toggleKind(kind)}
              className={cn("h-7 gap-1.5 px-2 text-xs", active && "bg-primary/10 text-primary")}
              aria-label={`Filter by ${label}`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </Toggle>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          After
          <Input
            type="date"
            value={filters.after ? filters.after.slice(0, 10) : ""}
            onChange={(e) => setAfter(e.target.value)}
            className="h-7 w-[140px] text-xs"
            aria-label="Uploaded after"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Before
          <Input
            type="date"
            value={filters.before ? filters.before.slice(0, 10) : ""}
            onChange={(e) => setBefore(e.target.value)}
            className="h-7 w-[140px] text-xs"
            aria-label="Uploaded before"
          />
        </label>
        {hasFilters && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onChange(initialAssetFilters)}
          >
            Clear filters
          </Button>
        )}
      </div>
    </div>
  )
}
