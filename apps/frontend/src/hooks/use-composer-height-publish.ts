import { useEffect } from "react"

/**
 * Measures the element referenced by `ref` and publishes its height (in px) as
 * `--composer-height` on the nearest `[data-editor-zone]` ancestor. Scrollable
 * siblings inside the same editor zone can consume the variable (Virtuoso
 * Footer spacer, plain-scroll `padding-bottom`) to reserve space for the
 * floating composer pill.
 *
 * Pass `active: false` (e.g. while the expand-to-fullscreen overlay is open)
 * to disconnect the observer and clear the variable so consumers collapse back
 * to zero.
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
      zone.style.setProperty("--composer-height", `${Math.ceil(h)}px`)
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
      zone.style.removeProperty("--composer-height")
    }
  }, [ref, active])
}
