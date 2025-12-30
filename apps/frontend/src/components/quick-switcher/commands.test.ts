import { describe, it, expect } from "vitest"
import { commands, type Command } from "./commands"

describe("commands", () => {
  it("should have at least one command defined", () => {
    expect(commands.length).toBeGreaterThan(0)
  })

  it("should have unique command IDs", () => {
    const ids = commands.map((c) => c.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  describe.each(commands)("command: $id", (command: Command) => {
    it("should have a non-empty id", () => {
      expect(command.id).toBeTruthy()
      expect(typeof command.id).toBe("string")
    })

    it("should have a non-empty label", () => {
      expect(command.label).toBeTruthy()
      expect(typeof command.label).toBe("string")
    })

    it("should have an icon component", () => {
      expect(command.icon).toBeDefined()
      // Lucide icons are forwardRef objects with $$typeof symbol
      expect(command.icon).toHaveProperty("$$typeof")
    })

    it("should have an action function", () => {
      expect(command.action).toBeDefined()
      expect(typeof command.action).toBe("function")
    })

    it("should have keywords as an array if defined", () => {
      if (command.keywords !== undefined) {
        expect(Array.isArray(command.keywords)).toBe(true)
        command.keywords.forEach((keyword) => {
          expect(typeof keyword).toBe("string")
        })
      }
    })
  })

  describe("specific commands", () => {
    it("should include new-scratchpad command", () => {
      const cmd = commands.find((c) => c.id === "new-scratchpad")
      expect(cmd).toBeDefined()
      expect(cmd?.label).toBe("New Scratchpad")
    })

    it("should include new-channel command", () => {
      const cmd = commands.find((c) => c.id === "new-channel")
      expect(cmd).toBeDefined()
      expect(cmd?.label).toBe("New Channel")
    })

    it("should include search command", () => {
      const cmd = commands.find((c) => c.id === "search")
      expect(cmd).toBeDefined()
      expect(cmd?.label).toBe("Search messages")
    })
  })
})
