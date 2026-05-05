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
 *
 * `onHeightChange` is called whenever the published height changes (including
 * on cleanup, where the height is reported as 0). This lets parent components
 * react to composer resizes — for example, re-scrolling a virtualized list so
 * the most recent message stays visible above the composer.
 */
export function useComposerHeightPublish(
  ref: React.RefObject<HTMLElement | null>,
  { active = true, onHeightChange }: { active?: boolean; onHeightChange?: (height: number) => void } = {}
): void {
  useEffect(() => {
    const el = ref.current
    if (!el || !active) return

    const zone = el.closest<HTMLElement>("[data-editor-zone]")
    if (!zone) return

    let lastHeight = -1

    const write = (h: number) => {
      const rounded = Math.ceil(h)
      if (rounded === lastHeight) return
      lastHeight = rounded
      zone.style.setProperty("--composer-height", `${rounded}px`)
      onHeightChange?.(rounded)
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
      if (lastHeight !== 0) {
        lastHeight = 0
        onHeightChange?.(0)
      }
    }
  }, [ref, active, onHeightChange])
}
