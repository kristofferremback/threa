import { useState, useRef, useEffect, useCallback } from "react"
import type { Editor } from "@tiptap/react"
import { Link2, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface LinkEditorProps {
  editor: Editor
  isActive: boolean
  initialUrl?: string
  autoFocusInput?: boolean
  selectionRange?: {
    from: number
    to: number
  }
  onClose: () => void
  className?: string
}

export function LinkEditor({
  editor,
  isActive,
  initialUrl,
  autoFocusInput = true,
  selectionRange,
  onClose,
  className,
}: LinkEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState(() => initialUrl ?? (editor.getAttributes("link").href || ""))

  useEffect(() => {
    setUrl(initialUrl ?? (editor.getAttributes("link").href || ""))
    if (!autoFocusInput) {
      return
    }

    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [autoFocusInput, editor, initialUrl])

  const restoreSelection = useCallback(() => {
    const chain = editor.chain().focus()

    if (selectionRange) {
      chain.setTextSelection(selectionRange)
    }

    return chain
  }, [editor, selectionRange])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (url.trim()) {
        const finalUrl = url.startsWith("http") ? url : `https://${url}`
        restoreSelection().extendMarkRange("link").setLink({ href: finalUrl }).run()
      } else {
        restoreSelection().extendMarkRange("link").unsetLink().run()
      }
      onClose()
    },
    [restoreSelection, url, onClose]
  )

  const handleRemoveLink = useCallback(() => {
    restoreSelection().extendMarkRange("link").unsetLink().run()
    onClose()
  }, [restoreSelection, onClose])

  const handleClose = useCallback(() => {
    restoreSelection().run()
    onClose()
  }, [restoreSelection, onClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        handleClose()
      }
    },
    [handleClose]
  )

  return (
    <div className={cn("flex items-center gap-2 border-b border-border/50 px-3 py-2 bg-muted/20", className)}>
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
        aria-label="Close link editor"
        onClick={handleClose}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
