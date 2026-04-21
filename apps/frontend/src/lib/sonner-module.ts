// Thin re-export so tests can spy on sonner's exports via a local (mutable)
// ESM namespace. Sonner's own package namespace is frozen and not spy-able.
export { Toaster as SonnerRoot, toast, useSonner } from "sonner"
export type { ToastT } from "sonner"
