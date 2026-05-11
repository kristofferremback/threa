import { describe, expect, test } from "bun:test"
import { OEMBED_PROVIDERS } from "./config"

describe("OEMBED_PROVIDERS", () => {
  test("routes X and Twitter status URLs to publish.twitter.com oEmbed", () => {
    const provider = OEMBED_PROVIDERS.find((entry) => entry.pattern.test("https://x.com/threaapp/status/1234567890"))
    expect(provider?.endpoint).toBe("https://publish.twitter.com/oembed")

    const legacyProvider = OEMBED_PROVIDERS.find((entry) =>
      entry.pattern.test("https://twitter.com/threaapp/status/1234567890")
    )
    expect(legacyProvider?.endpoint).toBe("https://publish.twitter.com/oembed")
  })
})
