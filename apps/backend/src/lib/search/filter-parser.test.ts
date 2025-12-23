import { describe, test, expect } from "bun:test"
import { parseQuery } from "./filter-parser"

describe("parseQuery", () => {
  test("extracts plain search terms", () => {
    const result = parseQuery("redis caching")

    expect(result.terms).toBe("redis caching")
    expect(result.filters).toEqual({})
  })

  test("extracts from:@user filter", () => {
    const result = parseQuery("redis caching from:@jane")

    expect(result.terms).toBe("redis caching")
    expect(result.filters.from).toEqual(["jane"])
  })

  test("extracts multiple from:@user filters", () => {
    const result = parseQuery("api design from:@jane from:@joe")

    expect(result.terms).toBe("api design")
    expect(result.filters.from).toEqual(["jane", "joe"])
  })

  test("extracts with:@user filter", () => {
    const result = parseQuery("architecture with:@jane")

    expect(result.terms).toBe("architecture")
    expect(result.filters.with).toEqual(["jane"])
  })

  test("extracts multiple with:@user filters", () => {
    const result = parseQuery("database with:@jane with:@joe")

    expect(result.terms).toBe("database")
    expect(result.filters.with).toEqual(["jane", "joe"])
  })

  test("extracts in:#channel filter", () => {
    const result = parseQuery("deployment in:#engineering")

    expect(result.terms).toBe("deployment")
    expect(result.filters.in).toEqual(["engineering"])
  })

  test("extracts is:type filter for valid stream types", () => {
    const result = parseQuery("discussion is:thread")

    expect(result.terms).toBe("discussion")
    expect(result.filters.is).toEqual(["thread"])
  })

  test("extracts multiple is:type filters", () => {
    const result = parseQuery("private is:dm is:thread")

    expect(result.terms).toBe("private")
    expect(result.filters.is).toEqual(["dm", "thread"])
  })

  test("ignores invalid is:type values", () => {
    const result = parseQuery("test is:invalid is:thread")

    expect(result.terms).toBe("test")
    expect(result.filters.is).toEqual(["thread"])
  })

  test("extracts before:date filter", () => {
    const result = parseQuery("meeting before:2025-01-01")

    expect(result.terms).toBe("meeting")
    expect(result.filters.before).toEqual(new Date("2025-01-01"))
  })

  test("extracts after:date filter", () => {
    const result = parseQuery("updates after:2024-06-15")

    expect(result.terms).toBe("updates")
    expect(result.filters.after).toEqual(new Date("2024-06-15"))
  })

  test("ignores invalid date formats", () => {
    const result = parseQuery("meeting before:not-a-date")

    expect(result.terms).toBe("meeting")
    expect(result.filters.before).toBeUndefined()
  })

  test("extracts multiple filter types", () => {
    const result = parseQuery("redis caching from:@jane with:@joe is:thread in:#engineering")

    expect(result.terms).toBe("redis caching")
    expect(result.filters.from).toEqual(["jane"])
    expect(result.filters.with).toEqual(["joe"])
    expect(result.filters.is).toEqual(["thread"])
    expect(result.filters.in).toEqual(["engineering"])
  })

  test("handles filters at different positions", () => {
    const result = parseQuery("from:@jane redis caching is:thread")

    expect(result.terms).toBe("redis caching")
    expect(result.filters.from).toEqual(["jane"])
    expect(result.filters.is).toEqual(["thread"])
  })

  test("normalizes usernames to lowercase", () => {
    const result = parseQuery("from:@JANE with:@JOE")

    expect(result.filters.from).toEqual(["jane"])
    expect(result.filters.with).toEqual(["joe"])
  })

  test("normalizes channel names to lowercase", () => {
    const result = parseQuery("in:#Engineering")

    expect(result.filters.in).toEqual(["engineering"])
  })

  test("handles empty query", () => {
    const result = parseQuery("")

    expect(result.terms).toBe("")
    expect(result.filters).toEqual({})
  })

  test("handles query with only filters", () => {
    const result = parseQuery("from:@jane is:dm")

    expect(result.terms).toBe("")
    expect(result.filters.from).toEqual(["jane"])
    expect(result.filters.is).toEqual(["dm"])
  })

  test("collapses multiple spaces", () => {
    const result = parseQuery("redis   caching   from:@jane")

    expect(result.terms).toBe("redis caching")
  })
})
