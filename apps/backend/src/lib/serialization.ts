/**
 * JSON replacer that converts BigInt to string for JSON serialization
 */
export function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value
}

/**
 * Recursively serialize BigInt values to strings in an object
 */
export function serializeBigInt<T>(value: T): T {
  if (typeof value === "bigint") {
    return value.toString() as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map(serializeBigInt) as unknown as T
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, serializeBigInt(v)]),
    ) as unknown as T
  }
  return value
}
