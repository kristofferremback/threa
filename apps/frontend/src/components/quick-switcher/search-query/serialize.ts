import type { QueryNode } from "./types"

/**
 * Serializes an array of query nodes back into a query string.
 *
 * Examples:
 * - [{ type: "filter", filterType: "from", value: "@martin" }] → "from:@martin"
 * - [{ type: "text", text: "restaurants" }] → "restaurants"
 * - [{ type: "text", text: "from:@martin", isQuoted: true }] → '"from:@martin"'
 */
export function serialize(nodes: QueryNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "filter") {
        return `${node.filterType}:${node.value}`
      }
      if (node.isQuoted) {
        return `"${node.text}"`
      }
      return node.text
    })
    .join(" ")
}
