import { useRef, useState, useEffect, useCallback } from "react"
import { useEditor, EditorContent } from "@tiptap/react"
import { createEditorExtensions } from "./editor-extensions"
import { EditorBehaviors } from "./editor-behaviors"
import { serializeToMarkdown, parseMarkdown } from "./editor-markdown"
import { EditorToolbar } from "./editor-toolbar"
import { cn } from "@/lib/utils"

interface RichEditorProps {
  value: string
  onChange: (markdown: string) => void
  onSubmit: () => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function RichEditor({
  value,
  onChange,
  onSubmit,
  placeholder = "Type a message...",
  disabled = false,
  className,
}: RichEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [, forceUpdate] = useState(0)
  const isInternalUpdate = useRef(false)

  // Debounced toolbar visibility - stays visible 150ms after conditions become false
  const shouldBeVisible = isFocused || linkPopoverOpen || dropdownOpen
  useEffect(() => {
    if (shouldBeVisible) {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
        hideTimeoutRef.current = null
      }
      setToolbarVisible(true)
    } else {
      hideTimeoutRef.current = setTimeout(() => {
        setToolbarVisible(false)
      }, 150)
    }
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current)
      }
    }
  }, [shouldBeVisible])

  const editor = useEditor({
    extensions: [...createEditorExtensions(placeholder), EditorBehaviors],
    content: parseMarkdown(value),
    editable: !disabled,
    onUpdate: ({ editor }) => {
      if (isInternalUpdate.current) return
      const markdown = serializeToMarkdown(editor.getJSON())
      onChange(markdown)
    },
    onTransaction: () => {
      // Force re-render on any transaction to update toolbar button states immediately
      // This includes formatting toggles (Cmd+B), selection changes, content changes
      forceUpdate((n) => n + 1)
    },
    onFocus: () => setIsFocused(true),
    onBlur: () => setIsFocused(false),
    editorProps: {
      attributes: {
        class: cn(
          "min-h-[80px] w-full px-3 py-2 outline-none",
          "prose prose-sm dark:prose-invert max-w-none",
          "focus:outline-none"
        ),
      },
      handleKeyDown: (_view, event) => {
        // Cmd/Ctrl+Enter to submit
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          onSubmit()
          return true
        }
        // Cmd/Ctrl+K to open link popover
        if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          setLinkPopoverOpen(true)
          return true
        }
        // Shift+Cmd/Ctrl+V to paste as plain text
        if (event.key === "v" && event.shiftKey && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          navigator.clipboard
            .readText()
            .then((text) => {
              editor?.commands.insertContent(text)
            })
            .catch(() => {
              // Clipboard access denied or unavailable - silently fail
            })
          return true
        }
        return false
      },
    },
  })

  // Sync external value changes (e.g., draft restoration, clearing after send)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return

    const currentMarkdown = serializeToMarkdown(editor.getJSON())
    if (value !== currentMarkdown) {
      isInternalUpdate.current = true
      editor.commands.setContent(parseMarkdown(value))
      isInternalUpdate.current = false
    }
  }, [value, editor])

  // Focus editor on mount
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.commands.focus("end")
    }
  }, [editor])

  // Expose focus method
  const focus = useCallback(() => {
    if (editor && !editor.isDestroyed) {
      editor.commands.focus("end")
    }
  }, [editor])

  // Re-focus after disabled changes (e.g., after sending)
  useEffect(() => {
    if (!disabled && editor && !editor.isDestroyed) {
      // Small delay to ensure editor is re-enabled
      const timer = setTimeout(() => focus(), 0)
      return () => clearTimeout(timer)
    }
  }, [disabled, editor, focus])

  return (
    <div ref={containerRef} className="relative flex-1">
      <EditorToolbar
        editor={editor}
        isVisible={toolbarVisible}
        referenceElement={containerRef.current}
        linkPopoverOpen={linkPopoverOpen}
        onLinkPopoverOpenChange={setLinkPopoverOpen}
        onDropdownOpenChange={setDropdownOpen}
      />
      <div
        className={cn(
          "rounded-md border border-input bg-background",
          "ring-offset-background transition-colors",
          "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          disabled && "cursor-not-allowed opacity-50",
          className
        )}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
