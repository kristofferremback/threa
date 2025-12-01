import { useEditor, EditorContent, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Placeholder from "@tiptap/extension-placeholder"
import Mention from "@tiptap/extension-mention"
import Link from "@tiptap/extension-link"
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight"
import { Markdown } from "tiptap-markdown"
import { common, createLowlight } from "lowlight"
import { forwardRef, useImperativeHandle, useEffect, useMemo, useRef, useState, useCallback } from "react"
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  CodeSquare,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  X,
} from "lucide-react"
import { createUserSuggestion, createChannelSuggestion } from "./mention-suggestion"

// Import tippy styles
import "tippy.js/dist/tippy.css"

// Create lowlight instance with common languages
const lowlight = createLowlight(common)

export interface RichTextEditorRef {
  focus: () => void
  clear: () => void
  getContent: () => string
  isEmpty: () => boolean
  getMentions: () => ExtractedMention[]
}

export interface ExtractedMention {
  type: "user" | "channel" | "crosspost"
  id: string
  label: string
  slug?: string
}

interface RichTextEditorProps {
  placeholder?: string
  disabled?: boolean
  onSubmit?: () => void
  onChange?: (content: string) => void
  className?: string
  autofocus?: boolean
  users?: Array<{ id: string; name: string; email: string }>
  channels?: Array<{ id: string; name: string; slug: string | null }>
  initialContent?: string
  initialMentions?: ExtractedMention[]
}

export const RichTextEditor = forwardRef<RichTextEditorRef, RichTextEditorProps>(
  (
    {
      placeholder = "Type a message...",
      disabled = false,
      onSubmit,
      onChange,
      className,
      autofocus = false,
      users = [],
      channels = [],
      initialContent = "",
      initialMentions = [],
    },
    ref,
  ) => {
    // Track if suggestion popup is open
    const suggestionOpenRef = useRef(false)

    // Link input state (lifted up so keyboard shortcut can trigger it)
    const [showLinkInput, setShowLinkInput] = useState(false)
    const [linkUrl, setLinkUrl] = useState("")
    const linkInputRef = useRef<HTMLInputElement>(null)

    // Memoize suggestion options
    const suggestionOptions = useMemo(() => ({ users, channels }), [users, channels])

    // Create mention extensions with tracking for popup state
    const userMention = useMemo(
      () =>
        Mention.extend({
          name: "userMention",
          addAttributes() {
            return {
              id: { default: null },
              label: { default: null },
              type: { default: "user" },
              email: { default: null },
              name: { default: null },
            }
          },
        }).configure({
          HTMLAttributes: {
            class: "mention mention-user",
          },
          suggestion: {
            ...createUserSuggestion(suggestionOptions),
            render: () => {
              const originalRender = createUserSuggestion(suggestionOptions).render!()
              return {
                onStart: (props) => {
                  suggestionOpenRef.current = true
                  originalRender.onStart?.(props)
                },
                onUpdate: (props) => {
                  originalRender.onUpdate?.(props)
                },
                onKeyDown: (props) => {
                  // Handle Tab to select
                  if (props.event.key === "Tab") {
                    props.event.preventDefault()
                    return (
                      originalRender.onKeyDown?.({ event: { ...props.event, key: "Enter" } as KeyboardEvent }) ?? false
                    )
                  }
                  return originalRender.onKeyDown?.(props) ?? false
                },
                onExit: () => {
                  suggestionOpenRef.current = false
                  originalRender.onExit?.()
                },
              }
            },
          },
          renderText: ({ node }) => `@${node.attrs.label}`,
        }),
      [suggestionOptions],
    )

    const channelMention = useMemo(
      () =>
        Mention.extend({
          name: "channelMention",
          addAttributes() {
            return {
              id: { default: null },
              label: { default: null },
              type: { default: "channel" },
              slug: { default: null },
            }
          },
        }).configure({
          HTMLAttributes: {
            class: "mention mention-channel",
          },
          suggestion: {
            ...createChannelSuggestion(suggestionOptions),
            render: () => {
              const originalRender = createChannelSuggestion(suggestionOptions).render!()
              return {
                onStart: (props) => {
                  suggestionOpenRef.current = true
                  originalRender.onStart?.(props)
                },
                onUpdate: (props) => {
                  originalRender.onUpdate?.(props)
                },
                onKeyDown: (props) => {
                  // Handle Tab to select
                  if (props.event.key === "Tab") {
                    props.event.preventDefault()
                    return (
                      originalRender.onKeyDown?.({ event: { ...props.event, key: "Enter" } as KeyboardEvent }) ?? false
                    )
                  }
                  return originalRender.onKeyDown?.(props) ?? false
                },
                onExit: () => {
                  suggestionOpenRef.current = false
                  originalRender.onExit?.()
                },
              }
            },
          },
          renderText: ({ node }) => {
            const isCrosspost = node.attrs.type === "crosspost"
            const prefix = isCrosspost ? "#+" : "#"
            return `${prefix}${node.attrs.slug || node.attrs.label}`
          },
        }),
      [suggestionOptions],
    )

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          heading: false,
          codeBlock: false, // We use CodeBlockLowlight instead
          hardBreak: {
            keepMarks: true,
          },
          horizontalRule: {
            HTMLAttributes: {
              class: "horizontal-rule",
            },
          },
        }),
        CodeBlockLowlight.extend({
          addAttributes() {
            return {
              ...this.parent?.(),
              language: {
                default: "plaintext",
                parseHTML: (element) =>
                  element.getAttribute("data-language") ||
                  element.querySelector("code")?.className?.replace("language-", "") ||
                  "plaintext",
                renderHTML: (attributes) => ({
                  "data-language": attributes.language,
                }),
              },
            }
          },
        }).configure({
          lowlight,
          defaultLanguage: "plaintext",
          HTMLAttributes: {
            class: "code-block",
          },
        }),
        Placeholder.configure({
          placeholder,
          emptyEditorClass: "is-editor-empty",
        }),
        Markdown.configure({
          html: false,
          transformCopiedText: true,
          transformPastedText: true,
        }),
        Link.configure({
          openOnClick: false, // Don't open links when clicking in editor
          autolink: true, // Auto-convert URLs to links
          linkOnPaste: true, // Convert pasted URLs to links
          HTMLAttributes: {
            class: "editor-link",
            rel: "noopener noreferrer",
            target: "_blank",
          },
        }),
        userMention,
        channelMention,
      ],
      // Don't set content here - we'll set it after editor is created to parse markdown
      content: "",
      editorProps: {
        attributes: {
          class: "outline-none min-h-[24px] max-h-[200px] overflow-y-auto",
          style: "color: var(--text-primary);",
        },
        handleKeyDown: (view, event) => {
          // Don't intercept if suggestion popup is open
          if (suggestionOpenRef.current) {
            return false
          }

          // Cmd/Ctrl + K for link
          if ((event.metaKey || event.ctrlKey) && event.key === "k") {
            event.preventDefault()
            // Check if there's already a link - if so, remove it
            if (editor?.isActive("link")) {
              editor.chain().focus().unsetLink().run()
            } else {
              // Open link input
              setLinkUrl("")
              setShowLinkInput(true)
              setTimeout(() => linkInputRef.current?.focus(), 0)
            }
            return true
          }

          // Wrap selection with markdown markers when typing *, `, ~
          const { state } = view
          const { from, to, empty } = state.selection

          if (!empty && !event.metaKey && !event.ctrlKey && !event.altKey) {
            const selectedText = state.doc.textBetween(from, to)

            // Handle backtick for inline code
            if (event.key === "`") {
              event.preventDefault()
              const tr = state.tr.replaceSelectionWith(state.schema.text("`" + selectedText + "`"), false)
              view.dispatch(tr)
              return true
            }

            // Handle asterisk for bold/italic
            if (event.key === "*") {
              event.preventDefault()
              // Check if previous char was also * (for bold)
              const charBefore = from > 0 ? state.doc.textBetween(from - 1, from) : ""
              if (charBefore === "*") {
                // Convert *selection to **selection** (bold)
                const tr = state.tr
                  .delete(from - 1, from) // Remove the first *
                  .replaceSelectionWith(state.schema.text("**" + selectedText + "**"), false)
                view.dispatch(tr)
              } else {
                // Single * for italic
                const tr = state.tr.replaceSelectionWith(state.schema.text("*" + selectedText + "*"), false)
                view.dispatch(tr)
              }
              return true
            }

            // Handle tilde for strikethrough
            if (event.key === "~") {
              event.preventDefault()
              // Check if previous char was also ~ (for strikethrough)
              const charBefore = from > 0 ? state.doc.textBetween(from - 1, from) : ""
              if (charBefore === "~") {
                // Convert ~selection to ~~selection~~ (strikethrough)
                const tr = state.tr
                  .delete(from - 1, from) // Remove the first ~
                  .replaceSelectionWith(state.schema.text("~~" + selectedText + "~~"), false)
                view.dispatch(tr)
              } else {
                // Just insert single ~ (will wait for second ~)
                return false
              }
              return true
            }
          }

          // Double space exits inline styling (bold, italic, code, etc.)
          if (event.key === " " && empty) {
            const charBefore = from > 1 ? state.doc.textBetween(from - 1, from) : ""
            if (charBefore === " ") {
              // Check if we have active marks
              const marks = state.storedMarks || state.doc.resolve(from).marks()
              if (marks.length > 0) {
                event.preventDefault()
                // Delete the previous space and clear marks, leaving just one space
                const tr = state.tr
                  .delete(from - 1, from) // Remove the trailing space
                  .setStoredMarks([]) // Clear marks
                  .insertText(" ") // Insert a single unstyled space
                view.dispatch(tr)
                return true
              }
            }
          }

          // Right arrow at end of document clears stored marks (exit styling)
          if (event.key === "ArrowRight") {
            const { from: arrowFrom, empty: arrowEmpty } = state.selection
            const atEnd = arrowFrom === state.doc.content.size - 1

            if (arrowEmpty && atEnd) {
              // Clear any stored marks so next typed char is unstyled
              const marks = state.storedMarks || state.doc.resolve(arrowFrom).marks()
              if (marks.length > 0) {
                view.dispatch(state.tr.setStoredMarks([]))
                return true
              }
            }
          }

          // Cmd/Ctrl + Enter always submits
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            onSubmit?.()
            return true
          }

          // Shift + Enter for newline (always works)
          if (event.key === "Enter" && event.shiftKey) {
            return false
          }

          // Plain Enter behavior depends on context
          if (event.key === "Enter" && !event.shiftKey) {
            const { state } = view
            const { $from } = state.selection

            // Check what block type we're in
            const inList =
              $from.parent.type.name === "listItem" ||
              (state.doc.resolve($from.pos).depth > 1 &&
                ["bulletList", "orderedList"].some(
                  (t) => $from.node($from.depth - 1)?.type.name === t || $from.node($from.depth - 2)?.type.name === t,
                ))
            const inCodeBlock = $from.parent.type.name === "codeBlock"
            const inBlockquote = ["blockquote"].some(
              (t) => $from.node($from.depth - 1)?.type.name === t || $from.node($from.depth)?.type.name === t,
            )

            // In code block: let TipTap handle Enter (new line)
            if (inCodeBlock) {
              return false
            }

            // In list: let TipTap handle Enter (new item or exit on empty)
            if (inList) {
              return false
            }

            // In blockquote: let TipTap handle (exits on empty paragraph)
            if (inBlockquote) {
              return false
            }

            // Regular paragraph: submit message
            event.preventDefault()
            onSubmit?.()
            return true
          }
          return false
        },
      },
      onUpdate: ({ editor }) => {
        // Get markdown content with proper mention serialization
        const content = getMarkdownContent(editor)
        onChange?.(content)
      },
      editable: !disabled,
      autofocus: autofocus ? "end" : false,
    })

    useEffect(() => {
      if (editor) {
        editor.setEditable(!disabled)
      }
    }, [editor, disabled])

    // Set initial content as markdown when editor is ready, including mentions
    // Track the content we've already set to avoid re-setting the same content
    const lastSetContentRef = useRef<string | null>(null)
    useEffect(() => {
      // Only set content if:
      // 1. Editor exists
      // 2. We have initial content to set
      // 3. We haven't already set this exact content
      if (!editor || !initialContent || lastSetContentRef.current === initialContent) {
        return
      }

      lastSetContentRef.current = initialContent

      // First, set the content (tiptap-markdown will parse markdown formatting)
      editor.commands.setContent(initialContent)

      // Then, replace mention text patterns with actual mention nodes
      if (initialMentions.length > 0) {
          // We need to find and replace mention text with mention nodes
          // Process in reverse order to not mess up positions
          const sortedMentions = [...initialMentions].reverse()

          for (const mention of sortedMentions) {
            let searchText: string
            if (mention.type === "user") {
              searchText = `@${mention.label}`
            } else if (mention.type === "crosspost") {
              searchText = `#+${mention.slug || mention.label}`
            } else {
              searchText = `#${mention.slug || mention.label}`
            }

            // Find the text in the document
            const { state } = editor
            let found = false
            state.doc.descendants((node, pos) => {
              if (found || !node.isText) return
              const text = node.text || ""
              const index = text.indexOf(searchText)
              if (index !== -1) {
                found = true
                const from = pos + index
                const to = from + searchText.length

                // Determine which mention type to use
                const mentionType = mention.type === "user" ? "userMention" : "channelMention"
                const attrs = {
                  id: mention.id,
                  label: mention.label,
                  ...(mention.type !== "user" && {
                    type: mention.type,
                    slug: mention.slug,
                  }),
                }

                // Replace the text with a mention node
                editor
                  .chain()
                  .focus()
                  .setTextSelection({ from, to })
                  .deleteSelection()
                  .insertContent({
                    type: mentionType,
                    attrs,
                  })
                  .run()
              }
            })
          }

          // Move cursor to end after inserting mentions
          editor.commands.focus("end")
        }
    }, [editor, initialContent, initialMentions])

    // Extract mentions from the editor content
    const getMentions = (): ExtractedMention[] => {
      if (!editor) return []

      const mentions: ExtractedMention[] = []
      const json = editor.getJSON()

      const traverse = (node: any) => {
        if (node.type === "userMention" && node.attrs) {
          mentions.push({
            type: "user",
            id: node.attrs.id,
            label: node.attrs.label,
          })
        } else if (node.type === "channelMention" && node.attrs) {
          mentions.push({
            type: node.attrs.type === "crosspost" ? "crosspost" : "channel",
            id: node.attrs.id,
            label: node.attrs.label,
            slug: node.attrs.slug,
          })
        }

        if (node.content) {
          node.content.forEach(traverse)
        }
      }

      if (json.content) {
        json.content.forEach(traverse)
      }

      return mentions
    }

    useImperativeHandle(ref, () => ({
      focus: () => {
        // Use 'end' to place cursor at end, and ensure the editor view is focused
        editor?.commands.focus("end")
      },
      clear: () => {
        editor?.commands.clearContent()
      },
      getContent: () => (editor ? getMarkdownContent(editor) : ""),
      isEmpty: () => editor?.isEmpty ?? true,
      getMentions,
    }))

    const handleLinkSubmit = useCallback(() => {
      if (linkUrl.trim() && editor) {
        // Add https:// if no protocol specified
        let url = linkUrl.trim()
        if (!/^https?:\/\//i.test(url) && !url.startsWith("/")) {
          url = "https://" + url
        }
        editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run()
      }
      setShowLinkInput(false)
      setLinkUrl("")
    }, [editor, linkUrl])

    const handleLinkKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault()
          handleLinkSubmit()
        } else if (e.key === "Escape") {
          setShowLinkInput(false)
          setLinkUrl("")
          editor?.chain().focus().run()
        }
      },
      [handleLinkSubmit, editor],
    )

    const handleLinkClick = useCallback(() => {
      if (!editor) return
      // Check if there's already a link
      const existingLink = editor.getAttributes("link").href
      if (existingLink) {
        // Remove the link
        editor.chain().focus().unsetLink().run()
      } else {
        // Show link input
        setLinkUrl("")
        setShowLinkInput(true)
        setTimeout(() => linkInputRef.current?.focus(), 0)
      }
    }, [editor])

    return (
      <div
        className={className}
        style={{
          background: "var(--bg-tertiary)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "0.5rem",
        }}
      >
        {editor && (
          <FormattingToolbar
            editor={editor}
            onLinkClick={handleLinkClick}
            showLinkInput={showLinkInput}
            linkUrl={linkUrl}
            onLinkUrlChange={setLinkUrl}
            onLinkSubmit={handleLinkSubmit}
            onLinkKeyDown={handleLinkKeyDown}
            onLinkCancel={() => {
              setShowLinkInput(false)
              setLinkUrl("")
              editor.chain().focus().run()
            }}
            linkInputRef={linkInputRef}
          />
        )}
        <EditorContent editor={editor} className="px-4 py-2.5 text-sm rich-text-editor" />
        <style>{`
          .rich-text-editor .ProseMirror {
            outline: none;
          }
          .rich-text-editor .ProseMirror p {
            margin: 0;
          }
          .rich-text-editor .ProseMirror p + p {
            margin-top: 0.25rem;
          }
          .rich-text-editor .ProseMirror strong {
            font-weight: 600;
          }
          .rich-text-editor .ProseMirror em {
            font-style: italic;
          }
          .rich-text-editor .ProseMirror s {
            text-decoration: line-through;
          }
          .rich-text-editor .ProseMirror code {
            padding: 0.125rem 0.375rem;
            border-radius: 0.25rem;
            font-family: var(--font-mono);
            font-size: 0.875em;
            background: var(--bg-secondary);
            color: var(--accent-primary);
          }
          .rich-text-editor .ProseMirror pre {
            padding: 0.75rem;
            border-radius: 0.5rem;
            font-family: var(--font-mono);
            font-size: 0.875em;
            background: rgba(39, 39, 42, 0.7);
            border: 1px solid rgba(63, 63, 70, 0.5);
            overflow-x: auto;
            margin: 0.5rem 0;
          }
          .rich-text-editor .ProseMirror pre code {
            padding: 0;
            background: none;
            color: #e4e4e7;
            display: block;
            white-space: pre;
          }
          /* Language label on code blocks */
          .rich-text-editor .ProseMirror pre[data-language]::before {
            content: attr(data-language);
            position: absolute;
            top: 0.25rem;
            right: 0.5rem;
            font-size: 0.625rem;
            text-transform: uppercase;
            color: #71717a;
            font-family: var(--font-sans);
          }
          .rich-text-editor .ProseMirror pre {
            position: relative;
          }
          /* Syntax highlighting (lowlight/highlight.js compatible) */
          .rich-text-editor .ProseMirror pre .hljs-keyword,
          .rich-text-editor .ProseMirror pre .hljs-selector-tag,
          .rich-text-editor .ProseMirror pre .hljs-deletion { color: #c678dd; }
          .rich-text-editor .ProseMirror pre .hljs-string,
          .rich-text-editor .ProseMirror pre .hljs-attr,
          .rich-text-editor .ProseMirror pre .hljs-addition { color: #98c379; }
          .rich-text-editor .ProseMirror pre .hljs-number,
          .rich-text-editor .ProseMirror pre .hljs-literal,
          .rich-text-editor .ProseMirror pre .hljs-link { color: #d19a66; }
          .rich-text-editor .ProseMirror pre .hljs-comment,
          .rich-text-editor .ProseMirror pre .hljs-quote { color: #5c6370; font-style: italic; }
          .rich-text-editor .ProseMirror pre .hljs-function,
          .rich-text-editor .ProseMirror pre .hljs-title,
          .rich-text-editor .ProseMirror pre .hljs-title.function_ { color: #61afef; }
          .rich-text-editor .ProseMirror pre .hljs-variable,
          .rich-text-editor .ProseMirror pre .hljs-params,
          .rich-text-editor .ProseMirror pre .hljs-template-variable { color: #e06c75; }
          .rich-text-editor .ProseMirror pre .hljs-type,
          .rich-text-editor .ProseMirror pre .hljs-built_in,
          .rich-text-editor .ProseMirror pre .hljs-class { color: #e5c07b; }
          .rich-text-editor .ProseMirror pre .hljs-meta,
          .rich-text-editor .ProseMirror pre .hljs-doctag { color: #abb2bf; }
          .rich-text-editor .ProseMirror pre .hljs-name,
          .rich-text-editor .ProseMirror pre .hljs-section { color: #e06c75; }
          .rich-text-editor .ProseMirror pre .hljs-selector-class,
          .rich-text-editor .ProseMirror pre .hljs-selector-id { color: #e5c07b; }
          .rich-text-editor .ProseMirror pre .hljs-regexp { color: #56b6c2; }
          .rich-text-editor .ProseMirror pre .hljs-symbol { color: #61afef; }
          .rich-text-editor .ProseMirror pre .hljs-punctuation { color: #abb2bf; }
          .rich-text-editor .ProseMirror hr,
          .rich-text-editor .ProseMirror .horizontal-rule {
            border: none;
            border-top: 1px solid rgba(113, 113, 122, 0.5);
            margin: 1rem 0;
          }
          .rich-text-editor .ProseMirror blockquote {
            border-left: 3px solid rgba(113, 113, 122, 0.5);
            padding-left: 1rem;
            margin: 0.5rem 0;
            color: #a1a1aa;
            font-style: italic;
          }
          .rich-text-editor .ProseMirror ul {
            list-style: disc;
            padding-left: 1.5rem;
            margin: 0.25rem 0;
          }
          .rich-text-editor .ProseMirror ol {
            list-style: decimal;
            padding-left: 1.5rem;
            margin: 0.25rem 0;
          }
          .rich-text-editor .ProseMirror li {
            margin: 0.125rem 0;
          }
          .rich-text-editor .ProseMirror li p {
            margin: 0;
          }
          .rich-text-editor .ProseMirror a,
          .rich-text-editor .ProseMirror .editor-link {
            color: #818cf8;
            text-decoration: underline;
            text-decoration-color: rgba(129, 140, 248, 0.4);
            cursor: text;
            transition: text-decoration-color 0.15s;
          }
          .rich-text-editor .ProseMirror a:hover,
          .rich-text-editor .ProseMirror .editor-link:hover {
            text-decoration-color: rgba(129, 140, 248, 0.8);
          }
          .rich-text-editor .is-editor-empty:first-child::before {
            content: attr(data-placeholder);
            float: left;
            color: var(--text-muted);
            pointer-events: none;
            height: 0;
          }

          /* Mention styles in editor */
          .mention {
            padding: 0.125rem 0.375rem;
            border-radius: 0.25rem;
            font-weight: 500;
            white-space: nowrap;
          }
          .mention-user {
            background: var(--accent-primary-muted, rgba(99, 102, 241, 0.15));
            color: var(--accent-primary);
          }
          .mention-channel {
            background: var(--bg-secondary);
            color: var(--text-primary);
          }

          /* Tippy mention popup theme */
          .tippy-box[data-theme~='mention'] {
            background: transparent;
            padding: 0;
          }
          .tippy-box[data-theme~='mention'] .tippy-content {
            padding: 0;
          }
          .tippy-box[data-theme~='mention'] .tippy-arrow {
            display: none;
          }
        `}</style>
      </div>
    )
  },
)

RichTextEditor.displayName = "RichTextEditor"

// Formatting toolbar component
interface FormattingToolbarProps {
  editor: Editor
  onLinkClick: () => void
  showLinkInput: boolean
  linkUrl: string
  onLinkUrlChange: (url: string) => void
  onLinkSubmit: () => void
  onLinkKeyDown: (e: React.KeyboardEvent) => void
  onLinkCancel: () => void
  linkInputRef: React.RefObject<HTMLInputElement>
}

function FormattingToolbar({
  editor,
  onLinkClick,
  showLinkInput,
  linkUrl,
  onLinkUrlChange,
  onLinkSubmit,
  onLinkKeyDown,
  onLinkCancel,
  linkInputRef,
}: FormattingToolbarProps) {
  const buttons = [
    {
      icon: Bold,
      label: "Bold",
      shortcut: "⌘B",
      action: () => editor.chain().focus().toggleBold().run(),
      isActive: () => editor.isActive("bold"),
    },
    {
      icon: Italic,
      label: "Italic",
      shortcut: "⌘I",
      action: () => editor.chain().focus().toggleItalic().run(),
      isActive: () => editor.isActive("italic"),
    },
    {
      icon: Strikethrough,
      label: "Strikethrough",
      shortcut: "⌘⇧S",
      action: () => editor.chain().focus().toggleStrike().run(),
      isActive: () => editor.isActive("strike"),
    },
    {
      icon: Code,
      label: "Inline Code",
      shortcut: "⌘E",
      action: () => editor.chain().focus().toggleCode().run(),
      isActive: () => editor.isActive("code"),
    },
    {
      icon: LinkIcon,
      label: "Link",
      shortcut: "⌘K",
      action: onLinkClick,
      isActive: () => editor.isActive("link"),
    },
    {
      icon: CodeSquare,
      label: "Code Block",
      action: () => {
        if (editor.isActive("codeBlock")) {
          // Exit code block - convert to paragraph
          editor.chain().focus().setNode("paragraph").run()
        } else {
          // Only convert current paragraph to code block
          const { from, to } = editor.state.selection
          const $from = editor.state.doc.resolve(from)
          const $to = editor.state.doc.resolve(to)

          // If selection spans multiple blocks, only use the first one
          if ($from.parent === $to.parent) {
            editor.chain().focus().setCodeBlock().run()
          } else {
            // Set selection to current paragraph only
            const start = $from.start()
            const end = $from.end()
            editor.chain().focus().setTextSelection({ from: start, to: end }).setCodeBlock().run()
          }
        }
      },
      isActive: () => editor.isActive("codeBlock"),
    },
    { type: "divider" as const },
    {
      icon: List,
      label: "Bullet List",
      action: () => editor.chain().focus().toggleBulletList().run(),
      isActive: () => editor.isActive("bulletList"),
    },
    {
      icon: ListOrdered,
      label: "Numbered List",
      action: () => editor.chain().focus().toggleOrderedList().run(),
      isActive: () => editor.isActive("orderedList"),
    },
    {
      icon: Quote,
      label: "Quote",
      action: () => editor.chain().focus().toggleBlockquote().run(),
      isActive: () => editor.isActive("blockquote"),
    },
  ]

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-zinc-700/50 relative">
      {buttons.map((button, index) => {
        if ("type" in button && button.type === "divider") {
          return <div key={index} className="w-px h-4 bg-zinc-700 mx-1" />
        }

        const Icon = button.icon
        const isActive = button.isActive?.()

        return (
          <button
            key={index}
            onClick={button.action}
            className={`p-1.5 rounded transition-colors ${
              isActive ? "bg-indigo-500/20 text-indigo-400" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50"
            }`}
            title={button.shortcut ? `${button.label} (${button.shortcut})` : button.label}
            type="button"
          >
            <Icon className="w-4 h-4" />
          </button>
        )
      })}

      {/* Link URL input popup */}
      {showLinkInput && (
        <div className="absolute left-0 top-full mt-1 z-50 flex items-center gap-1 p-2 bg-zinc-800 border border-zinc-700 rounded-lg shadow-lg">
          <input
            ref={linkInputRef}
            type="text"
            value={linkUrl}
            onChange={(e) => onLinkUrlChange(e.target.value)}
            onKeyDown={onLinkKeyDown}
            onBlur={() => {
              // Delay to allow button click
              setTimeout(() => {
                if (!linkUrl.trim()) {
                  onLinkCancel()
                }
              }, 150)
            }}
            placeholder="Enter URL..."
            className="w-64 px-2 py-1 text-sm bg-zinc-900 border border-zinc-600 rounded text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={onLinkSubmit}
            className="p-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
            type="button"
          >
            <LinkIcon className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onLinkCancel}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
            type="button"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}

// Custom markdown content getter that properly serializes mentions
function getMarkdownContent(editor: any): string {
  const json = editor.getJSON()
  return serializeToMarkdown(json)
}

function serializeToMarkdown(doc: any): string {
  if (!doc.content) return ""

  return doc.content
    .map((node: any) => serializeNode(node))
    .join("\n\n")
    .trim()
}

function serializeNode(node: any): string {
  switch (node.type) {
    case "paragraph":
      return serializeInlineContent(node.content || [])
    case "bulletList":
      return (node.content || []).map((item: any) => `- ${serializeNode(item)}`).join("\n")
    case "orderedList":
      return (node.content || []).map((item: any, i: number) => `${i + 1}. ${serializeNode(item)}`).join("\n")
    case "listItem":
      return (node.content || []).map((child: any) => serializeNode(child)).join("\n")
    case "blockquote":
      return (node.content || []).map((child: any) => `> ${serializeNode(child)}`).join("\n")
    case "codeBlock":
      const lang = node.attrs?.language || ""
      const code = (node.content || []).map((c: any) => c.text || "").join("")
      return "```" + lang + "\n" + code + "\n```"
    case "horizontalRule":
      return "---"
    default:
      return serializeInlineContent(node.content || [])
  }
}

function serializeInlineContent(content: any[]): string {
  return content
    .map((node: any) => {
      if (node.type === "text") {
        let text = node.text || ""
        const marks = node.marks || []

        // Apply marks in reverse order (innermost first)
        for (const mark of marks) {
          switch (mark.type) {
            case "bold":
              text = `**${text}**`
              break
            case "italic":
              text = `*${text}*`
              break
            case "strike":
              text = `~~${text}~~`
              break
            case "code":
              text = `\`${text}\``
              break
            case "link":
              text = `[${text}](${mark.attrs?.href || ""})`
              break
          }
        }
        return text
      }

      if (node.type === "userMention") {
        return `@${node.attrs?.label || ""}`
      }

      if (node.type === "channelMention") {
        const isCrosspost = node.attrs?.type === "crosspost"
        const prefix = isCrosspost ? "#+" : "#"
        return `${prefix}${node.attrs?.slug || node.attrs?.label || ""}`
      }

      if (node.type === "hardBreak") {
        return "\n"
      }

      return ""
    })
    .join("")
}
