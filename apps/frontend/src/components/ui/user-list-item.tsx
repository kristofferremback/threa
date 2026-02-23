import { getInitials } from "@/lib/initials"
import { getAvatarColor } from "@/lib/avatar-color"
import type { SearchableListItem } from "./searchable-list"

export interface UserListItem extends SearchableListItem {
  slug: string
  name: string
}

export function UserListItemRow({ item }: { item: UserListItem }) {
  const initials = getInitials(item.name || item.slug)
  const color = getAvatarColor(item.id)

  return (
    <div className="flex items-center gap-2.5 px-2.5 py-2">
      <div className={`flex items-center justify-center h-7 w-7 rounded-full text-xs font-medium shrink-0 ${color}`}>
        {initials}
      </div>
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <span className="text-sm font-medium truncate">{item.label}</span>
        <span className="text-xs text-muted-foreground truncate">{item.description}</span>
      </div>
    </div>
  )
}

export function renderUserListItem(item: UserListItem, _highlighted: boolean) {
  return <UserListItemRow item={item} />
}
