import { useState, useEffect, useMemo } from "react"
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command"
import { Calendar } from "@/components/ui/calendar"
import { format } from "date-fns"
import type { StreamType, WorkspaceMember, Stream, User } from "@threa/types"

interface StreamTypeOption {
  value: StreamType
  label: string
}

interface FilterSelectProps {
  type: "from" | "is" | "in" | "after" | "before"
  members: WorkspaceMember[]
  users: User[]
  streams: Stream[]
  streamTypes: StreamTypeOption[]
  onSelect: (value: string, label: string) => void
  onCancel: () => void
}

export function FilterSelect({ type, members, users, streams, streamTypes, onSelect, onCancel }: FilterSelectProps) {
  // Handle escape key to cancel
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onCancel])

  if (type === "from") {
    return <UserSelect members={members} users={users} onSelect={onSelect} />
  }

  if (type === "is") {
    return <StreamTypeSelect streamTypes={streamTypes} onSelect={onSelect} />
  }

  if (type === "in") {
    return <StreamSelect streams={streams} onSelect={onSelect} />
  }

  if (type === "after" || type === "before") {
    return <DateSelect type={type} onSelect={onSelect} />
  }

  return null
}

interface UserSelectProps {
  members: WorkspaceMember[]
  users: User[]
  onSelect: (value: string, label: string) => void
}

function UserSelect({ members, users, onSelect }: UserSelectProps) {
  const [search, setSearch] = useState("")

  // Create a lookup map for user names
  const userMap = useMemo(() => {
    const map = new Map<string, User>()
    for (const user of users) {
      map.set(user.id, user)
    }
    return map
  }, [users])

  const getUserName = (userId: string): string => {
    return userMap.get(userId)?.name ?? userId.substring(0, 8)
  }

  // Filter members by user name or ID
  const filtered = useMemo(() => {
    const searchLower = search.toLowerCase()
    return members.filter((m) => {
      const user = userMap.get(m.userId)
      const name = user?.name ?? ""
      return name.toLowerCase().includes(searchLower) || m.userId.toLowerCase().includes(searchLower)
    })
  }, [members, userMap, search])

  return (
    <div className="w-48">
      <Command className="border rounded-md">
        <CommandInput placeholder="Search users..." value={search} onValueChange={setSearch} className="h-8" />
        <CommandList className="max-h-32">
          <CommandEmpty>No users found.</CommandEmpty>
          <CommandGroup>
            {filtered.slice(0, 10).map((member) => {
              const name = getUserName(member.userId)
              return (
                <CommandItem key={member.userId} value={member.userId} onSelect={() => onSelect(member.userId, name)}>
                  {name}
                </CommandItem>
              )
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  )
}

interface StreamTypeSelectProps {
  streamTypes: StreamTypeOption[]
  onSelect: (value: string, label: string) => void
}

function StreamTypeSelect({ streamTypes, onSelect }: StreamTypeSelectProps) {
  return (
    <div className="w-40">
      <Command className="border rounded-md">
        <CommandList>
          <CommandGroup>
            {streamTypes.map((st) => (
              <CommandItem key={st.value} value={st.value} onSelect={() => onSelect(st.value, st.label)}>
                {st.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  )
}

interface StreamSelectProps {
  streams: Stream[]
  onSelect: (value: string, label: string) => void
}

function StreamSelect({ streams, onSelect }: StreamSelectProps) {
  const [search, setSearch] = useState("")

  const filtered = streams.filter((s) => {
    const name = s.displayName || s.slug || ""
    return name.toLowerCase().includes(search.toLowerCase())
  })

  const getStreamName = (stream: Stream) => {
    if (stream.slug) return `#${stream.slug}`
    return stream.displayName || "Untitled"
  }

  return (
    <div className="w-48">
      <Command className="border rounded-md">
        <CommandInput placeholder="Search streams..." value={search} onValueChange={setSearch} className="h-8" />
        <CommandList className="max-h-32">
          <CommandEmpty>No streams found.</CommandEmpty>
          <CommandGroup>
            {filtered.slice(0, 10).map((stream) => (
              <CommandItem
                key={stream.id}
                value={stream.id}
                onSelect={() => onSelect(stream.id, getStreamName(stream))}
              >
                {getStreamName(stream)}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  )
}

interface DateSelectProps {
  type: "after" | "before"
  onSelect: (value: string, label: string) => void
}

function DateSelect({ type, onSelect }: DateSelectProps) {
  const [date, setDate] = useState<Date | undefined>()

  const handleSelect = (selectedDate: Date | undefined) => {
    if (selectedDate) {
      setDate(selectedDate)
      const isoDate = selectedDate.toISOString()
      const label = `${type === "after" ? "After" : "Before"} ${format(selectedDate, "MMM d, yyyy")}`
      onSelect(isoDate, label)
    }
  }

  return (
    <div className="border rounded-md bg-popover p-2">
      <Calendar mode="single" selected={date} onSelect={handleSelect} initialFocus className="p-0" />
    </div>
  )
}
