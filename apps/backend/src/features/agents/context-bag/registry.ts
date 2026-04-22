import { ContextIntents, ContextRefKinds, type ContextIntent, type ContextRefKind } from "@threa/types"
import { ThreadResolver } from "./resolvers/thread-resolver"
import { DiscussThreadIntent } from "./intents/discuss-thread"
import type { IntentConfig, Resolver } from "./types"

const resolvers = new Map<ContextRefKind, Resolver>()
resolvers.set(ContextRefKinds.THREAD, ThreadResolver as Resolver)

const intents = new Map<ContextIntent, IntentConfig>()
intents.set(ContextIntents.DISCUSS_THREAD, DiscussThreadIntent)

export function getResolver(kind: ContextRefKind): Resolver {
  const resolver = resolvers.get(kind)
  if (!resolver) {
    throw new Error(`No resolver registered for ref kind "${kind}"`)
  }
  return resolver
}

export function getIntentConfig(intent: ContextIntent): IntentConfig {
  const config = intents.get(intent)
  if (!config) {
    throw new Error(`No intent config registered for intent "${intent}"`)
  }
  return config
}
