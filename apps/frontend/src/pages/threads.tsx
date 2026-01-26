import { useState, useCallback, useMemo } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { MessageSquareText, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ItemList, type QuickSwitcherItem } from "@/components/quick-switcher"
import { useWorkspaceBootstrap } from "@/hooks"
import { StreamTypes } from "@threa/types"
import { getThreadDisplayName, getThreadRootContext } from "@/components/thread/breadcrumb-helpers"

export function ThreadsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const navigate = useNavigate()
  const { data: bootstrap } = useWorkspaceBootstrap(workspaceId ?? "")
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Filter for thread type streams
  const threads = useMemo(() => {
    if (!bootstrap?.streams) return []
    return bootstrap.streams.filter((s) => s.type === StreamTypes.THREAD)
  }, [bootstrap?.streams])

  // Convert threads to QuickSwitcherItem format
  const items: QuickSwitcherItem[] = useMemo(() => {
    if (!bootstrap?.streams) return []

    return threads.map((thread) => {
      const displayName = getThreadDisplayName(thread, bootstrap.streams)
      const preview = thread.lastMessagePreview
      const previewText = preview ? `${preview.authorId}: ${preview.content ? "..." : "No messages"}` : "No messages"

      const rootContext = getThreadRootContext(thread, bootstrap.streams)
      const description = rootContext ? `in ${rootContext} · ${previewText}` : previewText

      return {
        id: thread.id,
        label: displayName,
        description,
        icon: MessageSquareText,
        href: `/w/${workspaceId}/s/${thread.id}`,
        onSelect: () => navigate(`/w/${workspaceId}/s/${thread.id}`),
      }
    })
  }, [threads, bootstrap?.streams, workspaceId, navigate])

  // Handle item selection (navigate or open in new tab)
  const handleSelectItem = useCallback((item: QuickSwitcherItem, withModifier: boolean) => {
    if (withModifier && item.href) {
      window.open(item.href, "_blank")
    } else {
      item.onSelect()
    }
  }, [])

  if (!workspaceId) {
    return null
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 items-center gap-3 border-b px-4">
        <Link to={`/w/${workspaceId}`}>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <MessageSquareText className="h-5 w-5 text-muted-foreground" />
          <h1 className="font-semibold">Threads</h1>
        </div>
      </header>
      <main
        className="flex-1 overflow-hidden"
        onKeyDown={(e) => {
          if (threads.length === 0) return

          const isMod = e.metaKey || e.ctrlKey

          switch (e.key) {
            case "ArrowDown":
              e.preventDefault()
              setSelectedIndex((prev) => Math.min(prev + 1, threads.length - 1))
              break
            case "ArrowUp":
              e.preventDefault()
              setSelectedIndex((prev) => Math.max(prev - 1, 0))
              break
            case "Enter": {
              e.preventDefault()
              const item = items[selectedIndex]
              if (item) {
                handleSelectItem(item, isMod)
              }
              break
            }
          }
        }}
        tabIndex={0}
      >
        <ItemList
          items={items}
          selectedIndex={selectedIndex}
          onSelectIndex={setSelectedIndex}
          onSelectItem={handleSelectItem}
          emptyMessage="No threads yet"
        />
      </main>
    </div>
  )
}
