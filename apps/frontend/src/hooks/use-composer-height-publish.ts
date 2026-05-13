import { useEffect } from "react"
import { persistComposerHeight } from "@/lib/composer-height-storage"

/**
 * Measures the element referenced by `ref` and publishes its height (in px) as
 * `--composer-height` on the nearest `[data-editor-zone]` ancestor. Scrollable
 * siblings inside the same editor zone can consume the variable (e.g.
 * plain-scroll `padding-bottom`) to reserve space for the floating composer
 * pill.
 *
 * Pass `active: false` (e.g. while the expand-to-fullscreen overlay is open)
 * to disconnect the observer. The CSS variable is intentionally *not* cleared
 * on cleanup so that stream navigation preserves the last-known height; the
 * next composer mount overwrites it with its own measurement. The same value
 * is also mirrored to localStorage so the next hard refresh starts with a
 * sensible global default on `:root` instead of falling back to 0px — that
 * fallback grew the timeline's footer spacer mid-paint and caused Virtuoso
 * to shift content up on every reload.
 */
export function useComposerHeightPublish(
  ref: React.RefObject<HTMLElement | null>,
  { active = true }: { active?: boolean } = {}
): void {
  useEffect(() => {
    const el = ref.current
    if (!el || !active) return

    const zone = el.closest<HTMLElement>("[data-editor-zone]")
    if (!zone) return

    const write = (h: number) => {
      const px = Math.ceil(h)
      zone.style.setProperty("--composer-height", `${px}px`)
      persistComposerHeight(px)
    }

    write(el.getBoundingClientRect().height)

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      const h = entry?.borderBoxSize?.[0]?.blockSize ?? entry?.contentRect.height ?? el.getBoundingClientRect().height
      write(h)
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      // Intentionally leave --composer-height set so stream navigation
      // starts with a reasonable approximation instead of falling back to 0px.
    }
  }, [ref, active])
}
