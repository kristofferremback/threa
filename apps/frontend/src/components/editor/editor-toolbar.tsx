import { useCallback, useLayoutEffect } from "react"
import type { Editor } from "@tiptap/react"
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/react"
import { Bold, Italic, Strikethrough, Link2, Quote, Code, Braces, List, ListOrdered } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { LinkEditor } from "./link-editor"
import { cn } from "@/lib/utils"

interface EditorToolbarProps {
  editor: Editor | null
  isVisible: boolean
  referenceElement: HTMLElement | null
  linkPopoverOpen?: boolean
  onLinkPopoverOpenChange?: (open: boolean) => void
  onDropdownOpenChange?: (open: boolean) => void
}

export function EditorToolbar({
  editor,
  isVisible,
  referenceElement,
  linkPopoverOpen,
  onLinkPopoverOpenChange,
}: EditorToolbarProps) {
  const { refs, floatingStyles } = useFloating({
    placement: "top-start",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  // Sync reference element to floating UI
  useLayoutEffect(() => {
    if (referenceElement) {
      refs.setReference(referenceElement)
    }
  }, [referenceElement, refs])

  if (!editor || !isVisible) return null

  const isLinkActive = editor.isActive("link")

  return (
    <TooltipProvider delayDuration={300}>
      <div ref={refs.setFloating} style={floatingStyles} className="z-50 flex flex-col gap-1">
        {/* Link editor - appears above toolbar when open */}
        {linkPopoverOpen && (
          <LinkEditor
            editor={editor}
            isActive={isLinkActive}
            onClose={() => onLinkPopoverOpenChange?.(false)}
            className="rounded-md border bg-popover p-2 shadow-md animate-in fade-in-0 slide-in-from-bottom-2 duration-150"
          />
        )}

        {/* Main toolbar */}
        <div
          className={cn(
            "flex items-center gap-0.5 rounded-md border bg-popover p-1 shadow-md",
            "animate-in fade-in-0 zoom-in-95 duration-150"
          )}
        >
          {/* Inline formatting - toggle marks */}
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
              if (isClosing) {
                editor.commands.focus()
              }
            }}
            icon={Link2}
            label="Link"
            isActive={isLinkActive || !!linkPopoverOpen}
          />

          <Separator orientation="vertical" className="mx-1 h-6" />

          {/* Block formatting - toggle blocks */}
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
        </div>
      </div>
    </TooltipProvider>
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
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    onAction()
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          onMouseDown={handleMouseDown}
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
