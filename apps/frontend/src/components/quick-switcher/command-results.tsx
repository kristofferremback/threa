import { CommandGroup, CommandItem } from "@/components/ui/command"
import { commands, type CommandContext } from "./commands"

interface CommandResultsProps {
  context: CommandContext
}

export function CommandResults({ context }: CommandResultsProps) {
  const handleSelect = async (commandId: string) => {
    const command = commands.find((c) => c.id === commandId)
    if (command) {
      await command.action(context)
    }
  }

  return (
    <CommandGroup heading="Commands">
      {commands.map((command) => {
        const Icon = command.icon
        const searchValue = [command.id, command.label, ...(command.keywords ?? [])].join(" ")

        return (
          <CommandItem key={command.id} value={searchValue} onSelect={() => handleSelect(command.id)}>
            <Icon className="mr-2 h-4 w-4 opacity-50" />
            <span>{command.label}</span>
          </CommandItem>
        )
      })}
    </CommandGroup>
  )
}
