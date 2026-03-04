import { useLayoutEffect, useEffect } from "react"
import type { Editor } from "@tiptap/react"
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/react"
import { Bold, Italic, Strikethrough, Link2, Quote, Code, Braces, List, ListOrdered, ChevronDown } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { LinkEditor } from "./link-editor"
import { cn } from "@/lib/utils"

interface EditorToolbarProps {
  editor: Editor | null
  isVisible: boolean
  linkPopoverOpen?: boolean
  onLinkPopoverOpenChange?: (open: boolean) => void
  /** Called when an internal dropdown (e.g. StylePicker) opens or closes */
  onDropdownOpenChange?: (open: boolean) => void
  /** Render as an inline block (no floating positioning). Used when the toolbar
   *  is pinned inside the input box via the format button. */
  inline?: boolean
}

export function EditorToolbar({
  editor,
  isVisible,
  linkPopoverOpen,
  onLinkPopoverOpenChange,
  onDropdownOpenChange,
  inline = false,
}: EditorToolbarProps) {
  const { refs, floatingStyles, update } = useFloating({
    placement: "top",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  // Virtual reference: position the toolbar above the current text selection
  useLayoutEffect(() => {
    refs.setReference({
      getBoundingClientRect() {
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          return sel.getRangeAt(0).getBoundingClientRect()
        }
        return new DOMRect()
      },
    })
  }, [refs])

  // Re-position whenever the selection moves.
  // EditorToolbar is always mounted in the tree — `return null` below is a
  // rendering guard only, not an unmount. Gating on isVisible and !inline avoids
  // unnecessary update() calls while the toolbar is hidden or in inline mode.
  useEffect(() => {
    if (!editor || !isVisible || inline) return
    editor.on("selectionUpdate", update)
    return () => {
      editor.off("selectionUpdate", update)
    }
  }, [editor, update, isVisible, inline])

  if (!editor || !isVisible) return null

  const isLinkActive = editor.isActive("link")

  const buttons = (
    <>
      <StylePicker editor={editor} onOpenChange={onDropdownOpenChange} />
      <Separator orientation="vertical" className="mx-1 h-6" />
      <ToolbarButton
        onAction={() => editor.chain().focus().toggleBold().run()}
        icon={Bold}
        label="Bold"
        shortcut="⌘B"
        isActive={editor.isActive("bold")}
      />
      <ToolbarButton
        onAction={() => editor.chain().focus().toggleItalic().run()}
        icon={Italic}
        label="Italic"
        shortcut="⌘I"
        isActive={editor.isActive("italic")}
      />
      <ToolbarButton
        onAction={() => editor.chain().focus().toggleStrike().run()}
        icon={Strikethrough}
        label="Strikethrough"
        shortcut="⌘⇧S"
        isActive={editor.isActive("strike")}
      />
      <ToolbarButton
        onAction={() => editor.chain().focus().toggleCode().run()}
        icon={Code}
        label="Inline code"
        shortcut="⌘E"
        isActive={editor.isActive("code")}
      />
      <ToolbarButton
        onAction={() => {
          const isClosing = !!linkPopoverOpen
          onLinkPopoverOpenChange?.(!linkPopoverOpen)
          if (isClosing) editor.commands.focus()
        }}
        icon={Link2}
        label="Link"
        isActive={isLinkActive || !!linkPopoverOpen}
      />
      <Separator orientation="vertical" className="mx-1 h-6" />
      <ToolbarButton
        onAction={() => editor.chain().focus().toggleBlockquote().run()}
        icon={Quote}
        label="Quote"
        isActive={editor.isActive("blockquote")}
      />
      <ToolbarButton
        onAction={() => editor.chain().focus().toggleBulletList().run()}
        icon={List}
        label="Bullet list"
        isActive={editor.isActive("bulletList")}
      />
      <ToolbarButton
        onAction={() => editor.chain().focus().toggleOrderedList().run()}
        icon={ListOrdered}
        label="Numbered list"
        isActive={editor.isActive("orderedList")}
      />
      <ToolbarButton
        onAction={() => editor.chain().focus().toggleCodeBlock().run()}
        icon={Braces}
        label="Code block"
        shortcut="⌘⇧C"
        isActive={editor.isActive("codeBlock")}
      />
    </>
  )

  if (inline) {
    return (
      <TooltipProvider delayDuration={300}>
        {linkPopoverOpen && (
          <LinkEditor
            editor={editor}
            isActive={isLinkActive}
            onClose={() => onLinkPopoverOpenChange?.(false)}
            className="rounded-md border bg-popover p-2 shadow-md mb-1"
          />
        )}
        <div className="relative border-b border-border/50 mb-1">
          <div className="flex items-center gap-0.5 py-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {buttons}
          </div>
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-card to-transparent" />
        </div>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div ref={refs.setFloating} style={floatingStyles} className="z-50 flex flex-col gap-1 max-w-[calc(100vw-16px)]">
        {linkPopoverOpen && (
          <LinkEditor
            editor={editor}
            isActive={isLinkActive}
            onClose={() => onLinkPopoverOpenChange?.(false)}
            className="rounded-md border bg-popover p-2 shadow-md animate-in fade-in-0 slide-in-from-bottom-2 duration-150"
          />
        )}
        <div className="relative">
          <div
            className={cn(
              "flex items-center gap-0.5 rounded-md border bg-popover p-1 shadow-md overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              "animate-in fade-in-0 zoom-in-95 duration-150"
            )}
          >
            {buttons}
          </div>
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 rounded-r-md bg-gradient-to-l from-popover to-transparent" />
        </div>
      </div>
    </TooltipProvider>
  )
}

function StylePicker({ editor, onOpenChange }: { editor: Editor; onOpenChange?: (open: boolean) => void }) {
  let activeLabel = "Normal"
  if (editor.isActive("heading", { level: 1 })) activeLabel = "Heading 1"
  else if (editor.isActive("heading", { level: 2 })) activeLabel = "Heading 2"
  else if (editor.isActive("heading", { level: 3 })) activeLabel = "Heading 3"

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs font-medium hover:bg-muted" tabIndex={-1}>
          {activeLabel}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[120px]">
        <DropdownMenuItem
          onSelect={() => editor.chain().focus().setParagraph().run()}
          className={cn("text-sm", !editor.isActive("heading") && "font-medium")}
        >
          Normal
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={cn("text-sm", editor.isActive("heading", { level: 1 }) && "font-medium")}
        >
          Heading 1
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={cn("text-sm", editor.isActive("heading", { level: 2 }) && "font-medium")}
        >
          Heading 2
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={cn("text-sm", editor.isActive("heading", { level: 3 }) && "font-medium")}
        >
          Heading 3
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface ToolbarButtonProps {
  onAction: () => void
  icon: React.ComponentType<{ className?: string }>
  label: string
  shortcut?: string
  isActive?: boolean
}

function ToolbarButton({ onAction, icon: Icon, label, shortcut, isActive }: ToolbarButtonProps) {
  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    onAction()
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          onPointerDown={handlePointerDown}
          className={cn("h-8 w-8 p-0 hover:bg-muted", isActive && "bg-muted-foreground/20 text-foreground")}
          tabIndex={-1}
          aria-label={label}
          aria-pressed={isActive}
        >
          <Icon className={cn("h-4 w-4", isActive && "stroke-[2.5px]")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium">{label}</span>
          {shortcut && <span className="text-muted-foreground">{shortcut}</span>}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
