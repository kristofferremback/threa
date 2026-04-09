import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronLeft, Quote, SmilePlus } from "lucide-react"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { useWorkspaceEmoji } from "@/hooks/use-workspace-emoji"
import { useMessageReactions, stripColons } from "@/hooks/use-message-reactions"
import { cn } from "@/lib/utils"
import { type MessageActionContext, type MessageAction, getVisibleActions } from "./message-actions"

const QUICK_REACTION_COUNT = 6

const DEFAULT_QUICK_EMOJIS = ["+1", "heart", "joy", "open_mouth", "cry", "fire"]

interface MessageActionDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  context: MessageActionContext
  /** Author display name for the message preview */
  authorName: string
}

export function MessageActionDrawer({ open, onOpenChange, context, authorName }: MessageActionDrawerProps) {
  const actions = getVisibleActions(context)
  const { emojis, emojiWeights } = useWorkspaceEmoji(context.workspaceId ?? "")
  const { toggleReaction } = useMessageReactions(context.workspaceId ?? "", context.messageId ?? "")
  const [expanded, setExpanded] = useState(false)
  const [selectedText, setSelectedText] = useState("")
  const contentRef = useRef<HTMLDivElement>(null)

  // Reset expanded state when drawer closes
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) setExpanded(false)
      onOpenChange(open)
    },
    [onOpenChange]
  )

  // Track text selection within the expanded content area
  useEffect(() => {
    if (!expanded) {
      setSelectedText("")
      return
    }

    const handleSelectionChange = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        setSelectedText("")
        return
      }

      const text = sel.toString().trim()
      if (!text) {
        setSelectedText("")
        return
      }

      // Verify selection is within our content area
      const range = sel.getRangeAt(0)
      if (contentRef.current?.contains(range.startContainer) && contentRef.current?.contains(range.endContainer)) {
        setSelectedText(text)
      } else {
        setSelectedText("")
      }
    }

    document.addEventListener("selectionchange", handleSelectionChange)
    return () => document.removeEventListener("selectionchange", handleSelectionChange)
  }, [expanded])

  const handleQuoteSelected = useCallback(() => {
    if (!selectedText || !context.onQuoteReplyWithSnippet) return
    context.onQuoteReplyWithSnippet(selectedText)
    window.getSelection()?.removeAllRanges()
    handleOpenChange(false)
  }, [selectedText, context, handleOpenChange])

  const handleBack = useCallback(() => {
    window.getSelection()?.removeAllRanges()
    setExpanded(false)
  }, [])

  const quickEmojis = useMemo(() => {
    if (!emojis.length) return []

    // Sort by weight descending, take top N
    const weighted = emojis
      .filter((e) => (emojiWeights[e.shortcode] ?? 0) > 0)
      .sort((a, b) => (emojiWeights[b.shortcode] ?? 0) - (emojiWeights[a.shortcode] ?? 0))
      .slice(0, QUICK_REACTION_COUNT)

    if (weighted.length >= QUICK_REACTION_COUNT) return weighted

    // Fill with defaults
    const usedShortcodes = new Set(weighted.map((e) => e.shortcode))
    const emojiMap = new Map(emojis.map((e) => [e.shortcode, e]))
    for (const shortcode of DEFAULT_QUICK_EMOJIS) {
      if (weighted.length >= QUICK_REACTION_COUNT) break
      const entry = emojiMap.get(shortcode)
      if (entry && !usedShortcodes.has(shortcode)) {
        weighted.push(entry)
        usedShortcodes.add(shortcode)
      }
    }
    return weighted
  }, [emojis, emojiWeights])

  const activeShortcodes = useMemo(() => {
    if (!context.currentUserId || !context.reactions) return new Set<string>()
    const active = new Set<string>()
    for (const [shortcode, userIds] of Object.entries(context.reactions)) {
      if (userIds.includes(context.currentUserId)) {
        active.add(stripColons(shortcode))
      }
    }
    return active
  }, [context.currentUserId, context.reactions])

  // Quick-react toggles: removes if user already reacted, adds otherwise
  const handleQuickReact = useCallback(
    (shortcode: string) => {
      handleOpenChange(false)
      toggleReaction(shortcode, context.reactions ?? {}, context.currentUserId ?? null)
    },
    [handleOpenChange, toggleReaction, context.reactions, context.currentUserId]
  )

  const handleAction = useCallback(
    (action: MessageAction) => {
      handleOpenChange(false)
      action.action?.(context)
    },
    [context, handleOpenChange]
  )

  const handleSubAction = useCallback(
    (sub: { action: (ctx: MessageActionContext) => void | Promise<void> }) => {
      handleOpenChange(false)
      sub.action(context)
    },
    [context, handleOpenChange]
  )

  if (!open && actions.length === 0) return null

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerContent className={cn("max-h-[85dvh]", expanded && "max-h-[95dvh]")}>
        {/* Accessible title (visually hidden) */}
        <DrawerTitle className="sr-only">{expanded ? "Select text to quote" : "Message actions"}</DrawerTitle>

        {expanded ? (
          <ExpandedQuoteView
            contentMarkdown={context.contentMarkdown}
            authorName={authorName}
            selectedText={selectedText}
            contentRef={contentRef}
            onBack={handleBack}
            onQuote={handleQuoteSelected}
          />
        ) : (
          <>
            {/* Message preview */}
            <div className="px-4 pt-1 pb-3">
              <div
                className={cn(
                  "rounded-xl bg-muted/60 px-3.5 py-2.5",
                  context.onQuoteReplyWithSnippet && "active:bg-muted/80 transition-colors"
                )}
                role={context.onQuoteReplyWithSnippet ? "button" : undefined}
                onClick={context.onQuoteReplyWithSnippet ? () => setExpanded(true) : undefined}
              >
                <p className="text-[13px] font-medium text-muted-foreground mb-0.5">{authorName}</p>
                <div className="text-sm text-foreground/80 line-clamp-2 leading-snug">
                  <MarkdownContent content={context.contentMarkdown} />
                </div>
              </div>
              {context.onQuoteReplyWithSnippet && (
                <p className="text-[11px] text-muted-foreground/60 mt-1 px-1">Tap to select quote</p>
              )}
            </div>

            {/* Quick reactions row + full picker button */}
            {quickEmojis.length > 0 && context.onReact && (
              <div className="flex justify-center gap-2 px-4 pb-3">
                {quickEmojis.map((entry) => {
                  const isActive = activeShortcodes.has(entry.shortcode)
                  return (
                    <button
                      key={entry.shortcode}
                      type="button"
                      className={cn(
                        "flex items-center justify-center w-10 h-10 rounded-full transition-colors text-xl",
                        isActive ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted active:bg-muted/80"
                      )}
                      title={`:${entry.shortcode}:`}
                      onClick={() => handleQuickReact(entry.shortcode)}
                    >
                      {entry.emoji}
                    </button>
                  )
                })}
                <button
                  type="button"
                  className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-muted active:bg-muted/80 transition-colors text-muted-foreground"
                  aria-label="More reactions"
                  onClick={() => {
                    handleOpenChange(false)
                    // Deferred so the drawer finishes closing before the picker opens
                    setTimeout(() => context.onOpenFullPicker?.(), 150)
                  }}
                >
                  <SmilePlus className="h-5 w-5" />
                </button>
              </div>
            )}

            {/* Action list */}
            <div className="px-2 pb-[max(12px,env(safe-area-inset-bottom))]">
              {actions.map((action) => {
                // Flatten sub-actions into separate rows (no nested menus on mobile)
                if (action.subActions && action.subActions.length > 0) {
                  return (
                    <div key={action.id}>
                      {action.separatorBefore && <Divider />}
                      {action.subActions.map((sub) => {
                        const SubIcon = sub.icon
                        return (
                          <button
                            key={sub.id}
                            type="button"
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm active:bg-muted/80 transition-colors"
                            onClick={() => handleSubAction(sub)}
                          >
                            <SubIcon className="h-[18px] w-[18px] text-muted-foreground shrink-0" />
                            <span>{sub.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  )
                }

                const Icon = action.icon
                const isDestructive = action.variant === "destructive"
                const href = action.getHref?.(context)

                const rowClassName = cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                  isDestructive ? "text-destructive active:bg-destructive/10" : "active:bg-muted/80"
                )
                const iconEl = (
                  <Icon
                    className={cn(
                      "h-[18px] w-[18px] shrink-0",
                      isDestructive ? "text-destructive" : "text-muted-foreground"
                    )}
                  />
                )

                return (
                  <div key={action.id}>
                    {action.separatorBefore && <Divider />}
                    {href ? (
                      <Link to={href} className={rowClassName} onClick={() => handleOpenChange(false)}>
                        {iconEl}
                        <span>{action.label}</span>
                      </Link>
                    ) : (
                      <button type="button" className={rowClassName} onClick={() => handleAction(action)}>
                        {iconEl}
                        <span>{action.label}</span>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}

interface ExpandedQuoteViewProps {
  contentMarkdown: string
  authorName: string
  selectedText: string
  contentRef: React.RefObject<HTMLDivElement | null>
  onBack: () => void
  onQuote: () => void
}

function ExpandedQuoteView({
  contentMarkdown,
  authorName,
  selectedText,
  contentRef,
  onBack,
  onQuote,
}: ExpandedQuoteViewProps) {
  return (
    <div className="flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-2 border-b">
        <button
          type="button"
          className="flex items-center justify-center h-8 w-8 rounded-full active:bg-muted/80 transition-colors"
          aria-label="Back to actions"
          onClick={onBack}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="text-sm font-medium">Select text to quote</span>
      </div>

      {/* Author name */}
      <div className="px-4 pt-3 pb-1">
        <p className="text-[13px] font-medium text-muted-foreground">{authorName}</p>
      </div>

      {/* Scrollable message content with text selection enabled */}
      <div
        ref={contentRef}
        data-vaul-no-drag
        className="flex-1 overflow-y-auto px-4 pb-3 select-text text-sm text-foreground/80 leading-snug"
      >
        <MarkdownContent content={contentMarkdown} />
      </div>

      {/* Quote button footer */}
      <div className="px-4 py-3 border-t pb-[max(12px,env(safe-area-inset-bottom))]">
        <Button className="w-full gap-2" disabled={!selectedText} onClick={onQuote}>
          <Quote className="h-4 w-4" />
          {selectedText ? "Quote selected text" : "Select text to quote"}
        </Button>
      </div>
    </div>
  )
}

function Divider() {
  return <Separator className="mx-3 my-1 bg-border/50" />
}
