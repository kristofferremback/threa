import { describe, test, expect } from "bun:test"
import { combineWithRRF } from "./rrf"

interface TestResult {
  id: string
  content: string
}

describe("combineWithRRF", () => {
  test("combines results from both lists", () => {
    const keyword: TestResult[] = [
      { id: "1", content: "first" },
      { id: "2", content: "second" },
    ]
    const semantic: TestResult[] = [
      { id: "3", content: "third" },
      { id: "4", content: "fourth" },
    ]

    const result = combineWithRRF(keyword, semantic)

    expect(result).toHaveLength(4)
    expect(result.map((r) => r.id)).toContain("1")
    expect(result.map((r) => r.id)).toContain("3")
  })

  test("ranks documents appearing in both lists higher", () => {
    const keyword: TestResult[] = [
      { id: "1", content: "shared" },
      { id: "2", content: "keyword only" },
    ]
    const semantic: TestResult[] = [
      { id: "3", content: "semantic only" },
      { id: "1", content: "shared" },
    ]

    const result = combineWithRRF(keyword, semantic)

    expect(result[0].id).toBe("1")
  })

  test("respects keyword weight priority with default weights", () => {
    // With default 60% keyword / 40% semantic, rank 1 keyword > rank 1 semantic
    const keyword: TestResult[] = [{ id: "k1", content: "keyword first" }]
    const semantic: TestResult[] = [{ id: "s1", content: "semantic first" }]

    const result = combineWithRRF(keyword, semantic)

    expect(result[0].id).toBe("k1")
  })

  test("respects custom weights", () => {
    const keyword: TestResult[] = [{ id: "k1", content: "keyword" }]
    const semantic: TestResult[] = [{ id: "s1", content: "semantic" }]

    // Give semantic higher weight
    const result = combineWithRRF(keyword, semantic, {
      keywordWeight: 0.3,
      semanticWeight: 0.7,
    })

    expect(result[0].id).toBe("s1")
  })

  test("handles empty keyword results", () => {
    const keyword: TestResult[] = []
    const semantic: TestResult[] = [
      { id: "1", content: "first" },
      { id: "2", content: "second" },
    ]

    const result = combineWithRRF(keyword, semantic)

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe("1")
  })

  test("handles empty semantic results", () => {
    const keyword: TestResult[] = [
      { id: "1", content: "first" },
      { id: "2", content: "second" },
    ]
    const semantic: TestResult[] = []

    const result = combineWithRRF(keyword, semantic)

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe("1")
  })

  test("handles both empty lists", () => {
    const result = combineWithRRF<TestResult>([], [])

    expect(result).toHaveLength(0)
  })

  test("preserves original item properties", () => {
    const keyword: TestResult[] = [{ id: "1", content: "hello world" }]
    const semantic: TestResult[] = []

    const result = combineWithRRF(keyword, semantic)

    expect(result[0].content).toBe("hello world")
  })

  test("deduplicates by id", () => {
    const keyword: TestResult[] = [
      { id: "1", content: "from keyword" },
      { id: "2", content: "two" },
    ]
    const semantic: TestResult[] = [
      { id: "1", content: "from semantic" },
      { id: "3", content: "three" },
    ]

    const result = combineWithRRF(keyword, semantic)

    expect(result).toHaveLength(3)
    expect(result.filter((r) => r.id === "1")).toHaveLength(1)
  })

  test("higher k reduces impact of top rankings", () => {
    const keyword: TestResult[] = [{ id: "1", content: "first" }]
    const semantic: TestResult[] = [{ id: "2", content: "second" }]

    // With default weights (60/40), keyword rank 1 beats semantic rank 1
    const result = combineWithRRF(keyword, semantic)

    // Keyword item should be first due to higher weight
    expect(result[0].id).toBe("1")
    expect(result[1].id).toBe("2")
  })
})
