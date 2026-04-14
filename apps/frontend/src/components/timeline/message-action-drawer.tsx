import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronLeft, Quote, SmilePlus } from "lucide-react"
import { Drawer, DrawerBody, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { MarkdownContent } from "@/components/ui/markdown-content"
import { useWorkspaceEmoji } from "@/hooks/use-workspace-emoji"
import { useMessageReactions, stripColons } from "@/hooks/use-message-reactions"
import { getInitials } from "@/lib/initials"
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
  // Snap points are controlled so tapping the preview can programmatically
  // jump to full-screen for the quote-selection view, while still letting the
  // user drag between 0.8 and 1 on the default action list.
  const [activeSnap, setActiveSnap] = useState<number | string | null>(0.8)

  // Keep snap in sync with expanded state (enter full-screen on expand,
  // return to 80% on collapse).
  useEffect(() => {
    setActiveSnap(expanded ? 1 : 0.8)
  }, [expanded])

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
    <Drawer
      open={open}
      onOpenChange={handleOpenChange}
      snapPoints={[0.8, 1]}
      activeSnapPoint={activeSnap}
      setActiveSnapPoint={setActiveSnap}
    >
      <DrawerContent>
        {/* Accessible title (visually hidden) */}
        <DrawerTitle className="sr-only">{expanded ? "Select text to quote" : "Message actions"}</DrawerTitle>

        {expanded ? (
          <ExpandedQuoteView
            contentMarkdown={context.contentMarkdown}
            authorName={authorName}
            actorType={context.actorType}
            selectedText={selectedText}
            contentRef={contentRef}
            onBack={handleBack}
            onQuote={handleQuoteSelected}
          />
        ) : (
          <DrawerBody className="px-0">
            {/* Message preview */}
            <div className="px-4 pt-1 pb-3">
              <div
                className={cn(
                  "group/preview relative rounded-xl bg-muted/60 px-3.5 py-2.5",
                  context.onQuoteReplyWithSnippet && "active:bg-muted/80 transition-colors cursor-pointer"
                )}
                role={context.onQuoteReplyWithSnippet ? "button" : undefined}
                onClick={context.onQuoteReplyWithSnippet ? () => setExpanded(true) : undefined}
              >
                <p className="text-[13px] font-medium text-muted-foreground mb-0.5">{authorName}</p>
                <div className="text-sm text-foreground/80 line-clamp-2 leading-snug pr-6">
                  <MarkdownContent content={context.contentMarkdown} />
                </div>
                {context.onQuoteReplyWithSnippet && (
                  <Quote
                    aria-hidden="true"
                    className="absolute top-2.5 right-2.5 h-3.5 w-3.5 text-muted-foreground/40 group-active/preview:text-primary transition-colors"
                  />
                )}
              </div>
              {context.onQuoteReplyWithSnippet && (
                <p className="text-[11px] text-muted-foreground/60 mt-1.5 px-1 flex items-center gap-1">
                  <span className="inline-block h-1 w-1 rounded-full bg-primary/60" />
                  Tap to highlight a passage
                </p>
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

            {/* Action list — DrawerBody owns scrolling + safe-area bottom padding */}
            <div className="px-2">
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
          </DrawerBody>
        )}
      </DrawerContent>
    </Drawer>
  )
}

interface ExpandedQuoteViewProps {
  contentMarkdown: string
  authorName: string
  actorType: string | null
  selectedText: string
  contentRef: React.RefObject<HTMLDivElement | null>
  onBack: () => void
  onQuote: () => void
}

function ExpandedQuoteView({
  contentMarkdown,
  authorName,
  actorType,
  selectedText,
  contentRef,
  onBack,
  onQuote,
}: ExpandedQuoteViewProps) {
  const initials = getInitials(authorName)
  const charCount = selectedText.length
  const isPersona = actorType === "persona"
  const isBot = actorType === "bot"
  const isSystem = actorType === "system"

  // Match timeline message-event.tsx accent styling exactly: persona=gold,
  // bot=emerald, system=blue, user=no accent. Inset shadow forms the left
  // "thread" stripe; gradient adds a faint actor-typed wash.
  const accentClass = cn(
    isPersona && "bg-gradient-to-r from-primary/[0.06] to-transparent shadow-[inset_3px_0_0_hsl(var(--primary))]",
    isBot && "bg-gradient-to-r from-emerald-500/[0.06] to-transparent shadow-[inset_3px_0_0_hsl(152_69%_41%)]",
    isSystem && "bg-gradient-to-r from-blue-500/[0.04] to-transparent shadow-[inset_3px_0_0_hsl(210_100%_55%)]"
  )

  // Decorative watermark color follows the same actor-typed logic, neutral for users
  const watermarkClass = cn(
    "absolute top-[-12px] right-3 text-[140px] leading-none font-serif select-none pointer-events-none",
    isPersona && "text-primary/[0.05]",
    isBot && "text-emerald-500/[0.05]",
    isSystem && "text-blue-500/[0.05]",
    !isPersona && !isBot && !isSystem && "text-muted-foreground/[0.08]"
  )

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Header — soft app-bar with gradient divider */}
      <div className="relative flex items-center gap-1 px-2 pt-2 pb-3">
        <button
          type="button"
          className="flex items-center justify-center h-9 w-9 rounded-full text-muted-foreground active:bg-muted/80 transition-colors"
          aria-label="Back to actions"
          onClick={onBack}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h2 className="text-[15px] font-semibold tracking-tight text-muted-foreground">Full message</h2>
        <div className="absolute left-0 right-0 bottom-0 h-px bg-gradient-to-r from-transparent via-border/70 to-transparent" />
      </div>

      {/* Scrollable byline + content as a single actor-typed block */}
      <div data-vaul-no-drag className="flex-1 min-h-0 overflow-y-auto">
        <div className={cn("relative", accentClass)}>
          {/* Decorative quote watermark */}
          <div aria-hidden="true" className={watermarkClass}>
            &ldquo;
          </div>

          {/* Byline — avatar anchored, matches timeline message style */}
          <div className="relative flex items-center gap-3 px-4 pt-4 pb-3">
            <Avatar className="h-9 w-9 rounded-[10px] shrink-0">
              <AvatarFallback
                className={cn(
                  "rounded-[10px] text-[13px] font-semibold",
                  isSystem && "bg-blue-500/10 text-blue-500",
                  isBot && "bg-emerald-500/10 text-emerald-600",
                  isPersona && "bg-primary/10 text-primary",
                  !isSystem && !isBot && !isPersona && "bg-muted text-foreground"
                )}
              >
                {initials}
              </AvatarFallback>
            </Avatar>
            <p
              className={cn(
                "text-sm font-semibold truncate",
                isPersona && "text-primary",
                isBot && "text-emerald-600",
                isSystem && "text-blue-500"
              )}
            >
              {authorName}
            </p>
          </div>

          {/* Selectable message content */}
          <div ref={contentRef} className="relative px-4 pb-6 select-text">
            <MarkdownContent content={contentMarkdown} className="text-sm leading-relaxed text-foreground" />
          </div>
        </div>
      </div>

      {/* Footer toolbar — compact, two-state */}
      <div className="relative px-4 pt-2.5 pb-[max(10px,env(safe-area-inset-bottom))]">
        <div
          aria-hidden="true"
          className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-border/70 to-transparent"
        />
        {selectedText ? (
          <div className="flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-1 duration-150">
            <p className="text-[12px] text-muted-foreground tabular-nums">
              <span className="font-semibold text-foreground/85">{charCount}</span>{" "}
              {charCount === 1 ? "character" : "characters"} selected
            </p>
            <Button size="sm" className="h-9 gap-1.5 px-3.5 font-medium" onClick={onQuote}>
              <Quote className="h-3.5 w-3.5" />
              Quote
            </Button>
          </div>
        ) : (
          <p className="text-[12px] text-muted-foreground/70 text-center py-1">
            Long-press the message to highlight a passage
          </p>
        )}
      </div>
    </div>
  )
}

function Divider() {
  return <Separator className="mx-3 my-1 bg-border/50" />
}
