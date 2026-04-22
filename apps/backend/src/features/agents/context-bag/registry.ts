import { ContextIntents, ContextRefKinds, type ContextIntent, type ContextRef, type ContextRefKind } from "@threa/types"
import { ThreadResolver } from "./resolvers/thread-resolver"
import { DiscussThreadIntent } from "./intents/discuss-thread"
import type { IntentConfig, Resolver } from "./types"

/**
 * Map a ref kind to its specific ref shape. `Extract` is a no-op today because
 * v1 only has one kind, but it makes the resolver table per-kind-safe so
 * adding a second kind later (e.g. `memo`) doesn't require any registry-side
 * casts.
 */
type ContextRefByKind = { [K in ContextRefKind]: Extract<ContextRef, { kind: K }> }
type ResolverByKind = { [K in ContextRefKind]: Resolver<ContextRefByKind[K]> }

const resolvers: ResolverByKind = {
  [ContextRefKinds.THREAD]: ThreadResolver,
}

const intents = new Map<ContextIntent, IntentConfig>()
intents.set(ContextIntents.DISCUSS_THREAD, DiscussThreadIntent)

export function getResolver<K extends ContextRefKind>(kind: K): ResolverByKind[K] {
  const resolver = resolvers[kind]
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
