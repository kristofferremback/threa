import { useState, useCallback, useEffect, useRef, useLayoutEffect } from "react"
import type { Editor } from "@tiptap/react"
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/react"
import { Bold, Italic, Strikethrough, Link2, Quote, Code, List, ListOrdered, ChevronDown, Check, X } from "lucide-react"
import { Toggle } from "@/components/ui/toggle"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
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
  onDropdownOpenChange,
}: EditorToolbarProps) {
  const { refs, floatingStyles } = useFloating({
    placement: "top-start",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  // Sync reference element to floating UI (must be in effect, not render)
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
          <LinkEditor editor={editor} isActive={isLinkActive} onClose={() => onLinkPopoverOpenChange?.(false)} />
        )}

        {/* Main toolbar */}
        <div
          className={cn(
            "flex items-center gap-0.5 rounded-md border bg-popover p-1 shadow-md",
            "animate-in fade-in-0 zoom-in-95 duration-150"
          )}
        >
          {/* Text type dropdown (Aa) */}
          <TextTypeDropdown editor={editor} onOpenChange={onDropdownOpenChange} />

          <Separator orientation="vertical" className="mx-1 h-6" />

          {/* Inline formatting */}
          <ToolbarButton
            isActive={editor.isActive("bold")}
            onAction={() => editor.chain().focus().toggleBold().run()}
            icon={Bold}
            label="Bold"
            shortcut="⌘B"
            markdown="**text**"
          />
          <ToolbarButton
            isActive={editor.isActive("italic")}
            onAction={() => editor.chain().focus().toggleItalic().run()}
            icon={Italic}
            label="Italic"
            shortcut="⌘I"
            markdown="*text*"
          />
          <ToolbarButton
            isActive={editor.isActive("strike")}
            onAction={() => editor.chain().focus().toggleStrike().run()}
            icon={Strikethrough}
            label="Strikethrough"
            markdown="~~text~~"
          />
          <ToolbarButton
            isActive={isLinkActive || !!linkPopoverOpen}
            onAction={() => {
              const isClosing = !!linkPopoverOpen
              onLinkPopoverOpenChange?.(!linkPopoverOpen)
              if (isClosing) {
                editor.commands.focus()
              }
            }}
            icon={Link2}
            label="Link"
            shortcut="⌘K"
            markdown="[text](url)"
          />

          <Separator orientation="vertical" className="mx-1 h-6" />

          {/* Block formatting */}
          <ToolbarButton
            isActive={editor.isActive("blockquote")}
            onAction={() => editor.chain().focus().toggleBlockquote().run()}
            icon={Quote}
            label="Quote"
            markdown="> quote"
          />
          <ToolbarButton
            isActive={editor.isActive("code")}
            onAction={() => editor.chain().focus().toggleCode().run()}
            icon={Code}
            label="Code"
            shortcut="⌘E"
            markdown="`code`"
          />

          <Separator orientation="vertical" className="mx-1 h-6" />

          {/* List dropdown */}
          <ListDropdown editor={editor} onOpenChange={onDropdownOpenChange} />
        </div>
      </div>
    </TooltipProvider>
  )
}

// Text type dropdown (Aa → Regular/H1/H2/H3)
function TextTypeDropdown({ editor, onOpenChange }: { editor: Editor; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false)

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen)
      onOpenChange?.(isOpen)
    },
    [onOpenChange]
  )

  const getCurrentType = () => {
    if (editor.isActive("heading", { level: 1 })) return "Heading 1"
    if (editor.isActive("heading", { level: 2 })) return "Heading 2"
    if (editor.isActive("heading", { level: 3 })) return "Heading 3"
    return "Regular text"
  }

  const textTypes = [
    { label: "Regular text", action: () => editor.chain().focus().setParagraph().run(), markdown: null },
    { label: "Heading 1", action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), markdown: "#" },
    { label: "Heading 2", action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), markdown: "##" },
    { label: "Heading 3", action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), markdown: "###" },
  ]

  const currentType = getCurrentType()

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 font-normal" tabIndex={-1}>
              <span className="text-sm font-medium">Aa</span>
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Text style
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-40" onCloseAutoFocus={(e) => e.preventDefault()}>
        {textTypes.map((type) => (
          <DropdownMenuItem
            key={type.label}
            onMouseDown={(e) => e.preventDefault()}
            onSelect={() => {
              type.action()
              handleOpenChange(false)
            }}
            className={cn(
              "flex items-center justify-between",
              type.label.startsWith("Heading") && "font-semibold",
              type.label === "Heading 1" && "text-lg",
              type.label === "Heading 2" && "text-base",
              type.label === "Heading 3" && "text-sm"
            )}
          >
            <span>{type.label}</span>
            {currentType === type.label && <Check className="h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// List dropdown (bullet/numbered)
function ListDropdown({ editor, onOpenChange }: { editor: Editor; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false)

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      setOpen(isOpen)
      onOpenChange?.(isOpen)
    },
    [onOpenChange]
  )

  const isActive = editor.isActive("bulletList") || editor.isActive("orderedList")
  const currentList = editor.isActive("bulletList") ? "bullet" : editor.isActive("orderedList") ? "ordered" : null

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Toggle
              size="sm"
              pressed={isActive}
              className={cn("h-8 gap-0.5 px-2 hover:bg-muted", isActive && "bg-muted-foreground/20 text-foreground")}
              tabIndex={-1}
            >
              <List className={cn("h-4 w-4", isActive && "stroke-[2.5px]")} />
              <ChevronDown className="h-3 w-3 opacity-50" />
            </Toggle>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">List</span>
            <span className="text-muted-foreground">- item · 1. item</span>
          </div>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-40" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuItem
          onMouseDown={(e) => e.preventDefault()}
          onSelect={() => {
            editor.chain().focus().toggleBulletList().run()
            handleOpenChange(false)
          }}
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <List className="h-4 w-4" />
            <span>Bullet list</span>
          </div>
          {currentList === "bullet" && <Check className="h-4 w-4" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          onMouseDown={(e) => e.preventDefault()}
          onSelect={() => {
            editor.chain().focus().toggleOrderedList().run()
            handleOpenChange(false)
          }}
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <ListOrdered className="h-4 w-4" />
            <span>Numbered list</span>
          </div>
          {currentList === "ordered" && <Check className="h-4 w-4" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface ToolbarButtonProps {
  isActive: boolean
  onAction: () => void
  icon: React.ComponentType<{ className?: string }>
  label: string
  shortcut?: string
  markdown?: string
}

function ToolbarButton({ isActive, onAction, icon: Icon, label, shortcut, markdown }: ToolbarButtonProps) {
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    onAction()
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          pressed={isActive}
          onMouseDown={handleMouseDown}
          className={cn("h-8 w-8 p-0 hover:bg-muted", isActive && "bg-muted-foreground/20 text-foreground")}
          tabIndex={-1}
        >
          <Icon className={cn("h-4 w-4", isActive && "stroke-[2.5px]")} />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{label}</span>
          {(shortcut || markdown) && (
            <span className="text-muted-foreground">
              {shortcut && markdown ? `${shortcut} · ${markdown}` : shortcut || markdown}
            </span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

interface LinkEditorProps {
  editor: Editor
  isActive: boolean
  onClose: () => void
}

function LinkEditor({ editor, isActive, onClose }: LinkEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const currentUrl = editor.getAttributes("link").href || ""
  const [url, setUrl] = useState(currentUrl)

  useEffect(() => {
    setUrl(currentUrl)
    // Focus input after mount
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [currentUrl])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (url.trim()) {
        const finalUrl = url.startsWith("http") ? url : `https://${url}`
        editor.chain().focus().extendMarkRange("link").setLink({ href: finalUrl }).run()
      } else {
        editor.chain().focus().extendMarkRange("link").unsetLink().run()
      }
      onClose()
    },
    [editor, url, onClose]
  )

  const handleRemoveLink = useCallback(() => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run()
    onClose()
  }, [editor, onClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
        editor.commands.focus()
      }
    },
    [onClose, editor]
  )

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border bg-popover p-2 shadow-md",
        "animate-in fade-in-0 slide-in-from-bottom-2 duration-150"
      )}
    >
      <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      <form onSubmit={handleSubmit} className="flex flex-1 items-center gap-2">
        <Input
          ref={inputRef}
          placeholder="https://example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          className="h-7 flex-1 text-sm"
        />
        <Button type="submit" size="sm" className="h-7 px-3">
          {isActive ? "Update" : "Add"}
        </Button>
        {isActive && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-destructive hover:text-destructive"
            onClick={handleRemoveLink}
          >
            Remove
          </Button>
        )}
      </form>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 w-7 shrink-0 p-0"
        onClick={() => {
          onClose()
          editor.commands.focus()
        }}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
