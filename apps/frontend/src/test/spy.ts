import { vi } from "vitest"

interface ExportSpy<V> {
  mockReturnValue(value: V): ExportSpy<V>
  mockImplementation(factory: () => V): ExportSpy<V>
  mockRestore(): void
}

/**
 * Spy on a module export as if it were a getter so tests can replace const
 * exports (forwardRef components, const objects, re-exported defaults) whose
 * ESM namespace TypeScript types don't model as getter accessors. At runtime
 * Vite makes the bindings configurable, so the replacement still works.
 */
export function spyOnExport<T extends object, K extends keyof T>(ns: T, key: K): ExportSpy<T[K]> {
  const untypedSpyOn = vi.spyOn as unknown as (obj: unknown, key: string, accessor: "get") => ExportSpy<T[K]>
  return untypedSpyOn(ns, key as string, "get")
}
