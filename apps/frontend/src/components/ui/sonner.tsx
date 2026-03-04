import { useEffect, useMemo, useRef } from "react"
import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from "lucide-react"
import { Toaster as Sonner, toast, useSonner } from "sonner"
import { usePreferences } from "@/contexts"
import { useIsMobile } from "@/hooks/use-mobile"

type ToasterProps = React.ComponentProps<typeof Sonner>
type ToastPosition = NonNullable<ToasterProps["position"]>

const MOBILE_TOAST_POSITION: ToastPosition = "top-center"
const DESKTOP_TOAST_POSITION: ToastPosition = "bottom-right"

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = usePreferences()
  const isMobile = useIsMobile()
  const { toasts } = useSonner()
  const toasterRef = useRef<HTMLElement | null>(null)

  const defaultPosition: ToastPosition = props.position ?? (isMobile ? MOBILE_TOAST_POSITION : DESKTOP_TOAST_POSITION)

  const filteredToasts = useMemo(() => {
    if (props.id) {
      return toasts.filter((activeToast) => activeToast.toasterId === props.id)
    }
    return toasts.filter((activeToast) => !activeToast.toasterId)
  }, [props.id, toasts])

  useEffect(() => {
    const root = toasterRef.current
    if (!root) return

    const handleToastClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return

      // Keep action/cancel/close controls clickable without dismissing the toast body.
      if (target.closest("button,a,input,textarea,select,label,[role='button']")) return

      const toastElement = target.closest<HTMLElement>("[data-sonner-toast]")
      if (!toastElement || toastElement.dataset.dismissible === "false") return

      const indexRaw = toastElement.dataset.index
      const y = toastElement.dataset.yPosition
      const x = toastElement.dataset.xPosition
      if (!indexRaw || !y || !x) return

      const index = Number.parseInt(indexRaw, 10)
      if (!Number.isFinite(index)) return

      const clickedPosition = `${y}-${x}` as ToastPosition
      const toastsAtPosition = filteredToasts.filter(
        (activeToast) => (activeToast.position ?? defaultPosition) === clickedPosition
      )
      const clickedToast = toastsAtPosition[index]
      if (!clickedToast) return

      toast.dismiss(clickedToast.id)
    }

    root.addEventListener("click", handleToastClick)
    return () => root.removeEventListener("click", handleToastClick)
  }, [defaultPosition, filteredToasts])

  return (
    <Sonner
      ref={toasterRef}
      theme={resolvedTheme}
      position={defaultPosition}
      mobileOffset={{
        top: "max(12px, env(safe-area-inset-top))",
        left: 12,
        right: 12,
      }}
      className="toaster group"
      icons={{
        success: <CircleCheck className="h-4 w-4" />,
        info: <Info className="h-4 w-4" />,
        warning: <TriangleAlert className="h-4 w-4" />,
        error: <OctagonX className="h-4 w-4" />,
        loading: <LoaderCircle className="h-4 w-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "group toast cursor-pointer data-[dismissible=false]:cursor-default group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
