import { Node, mergeAttributes } from "@tiptap/core"

export const HorizontalRuleExtension = Node.create({
  name: "horizontalRule",
  group: "block",
  selectable: false,

  parseHTML() {
    return [{ tag: "hr" }]
  },

  renderHTML({ HTMLAttributes }) {
    return ["hr", mergeAttributes(HTMLAttributes)]
  },
})
