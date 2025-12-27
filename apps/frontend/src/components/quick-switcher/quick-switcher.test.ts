import { describe, it, expect } from "vitest"

// Mode detection logic extracted for testing
function deriveMode(query: string): "stream" | "command" | "search" {
  if (query.startsWith(">")) return "command"
  if (query.startsWith("?")) return "search"
  return "stream"
}

function getDisplayQuery(query: string, mode: "stream" | "command" | "search"): string {
  if (mode === "command" && query.startsWith(">")) {
    return query.slice(1).trimStart()
  }
  if (mode === "search" && query.startsWith("?")) {
    return query.slice(1).trimStart()
  }
  return query
}

describe("QuickSwitcher mode detection", () => {
  describe("deriveMode", () => {
    it("should return 'stream' for empty query", () => {
      expect(deriveMode("")).toBe("stream")
    })

    it("should return 'stream' for regular text", () => {
      expect(deriveMode("general")).toBe("stream")
      expect(deriveMode("my channel")).toBe("stream")
    })

    it("should return 'command' for queries starting with >", () => {
      expect(deriveMode(">")).toBe("command")
      expect(deriveMode(">new")).toBe("command")
      expect(deriveMode("> create channel")).toBe("command")
    })

    it("should return 'search' for queries starting with ?", () => {
      expect(deriveMode("?")).toBe("search")
      expect(deriveMode("?error")).toBe("search")
      expect(deriveMode("? find logs")).toBe("search")
    })

    it("should only check first character for mode", () => {
      expect(deriveMode("text > with arrow")).toBe("stream")
      expect(deriveMode("text ? with question")).toBe("stream")
    })
  })

  describe("getDisplayQuery", () => {
    describe("stream mode", () => {
      it("should return query as-is", () => {
        expect(getDisplayQuery("general", "stream")).toBe("general")
        expect(getDisplayQuery("", "stream")).toBe("")
      })
    })

    describe("command mode", () => {
      it("should strip leading > and whitespace", () => {
        expect(getDisplayQuery(">new", "command")).toBe("new")
        expect(getDisplayQuery("> new", "command")).toBe("new")
        expect(getDisplayQuery(">  new channel", "command")).toBe("new channel")
      })

      it("should return empty string for just >", () => {
        expect(getDisplayQuery(">", "command")).toBe("")
        expect(getDisplayQuery("> ", "command")).toBe("")
      })

      it("should not strip if no > prefix", () => {
        expect(getDisplayQuery("new", "command")).toBe("new")
      })
    })

    describe("search mode", () => {
      it("should strip leading ? and whitespace", () => {
        expect(getDisplayQuery("?error", "search")).toBe("error")
        expect(getDisplayQuery("? error", "search")).toBe("error")
        expect(getDisplayQuery("?  find logs", "search")).toBe("find logs")
      })

      it("should return empty string for just ?", () => {
        expect(getDisplayQuery("?", "search")).toBe("")
        expect(getDisplayQuery("? ", "search")).toBe("")
      })

      it("should not strip if no ? prefix", () => {
        expect(getDisplayQuery("error", "search")).toBe("error")
      })
    })
  })
})
