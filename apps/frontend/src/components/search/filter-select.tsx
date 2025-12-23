import { useState, useEffect } from "react"
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command"
import { Calendar } from "@/components/ui/calendar"
import { format } from "date-fns"
import type { StreamType, WorkspaceMember, Stream } from "@threa/types"

interface StreamTypeOption {
  value: StreamType
  label: string
}

interface FilterSelectProps {
  type: "from" | "is" | "in" | "after" | "before"
  members: WorkspaceMember[]
  streams: Stream[]
  streamTypes: StreamTypeOption[]
  onSelect: (value: string, label: string) => void
  onCancel: () => void
}

export function FilterSelect({ type, members, streams, streamTypes, onSelect, onCancel }: FilterSelectProps) {
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
    return <UserSelect members={members} onSelect={onSelect} />
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
  onSelect: (value: string, label: string) => void
}

function UserSelect({ members, onSelect }: UserSelectProps) {
  const [search, setSearch] = useState("")

  const filtered = members.filter((m) => m.userId.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="w-48">
      <Command className="border rounded-md">
        <CommandInput placeholder="Search users..." value={search} onValueChange={setSearch} className="h-8" />
        <CommandList className="max-h-32">
          <CommandEmpty>No users found.</CommandEmpty>
          <CommandGroup>
            {filtered.slice(0, 10).map((member) => (
              <CommandItem
                key={member.userId}
                value={member.userId}
                onSelect={() => onSelect(member.userId, member.userId)}
              >
                {member.userId}
              </CommandItem>
            ))}
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
