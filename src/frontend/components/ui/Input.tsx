import { forwardRef, type InputHTMLAttributes } from "react"
import { clsx } from "clsx"

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, error, style, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={clsx(
        "w-full rounded-lg px-4 py-2.5 text-sm outline-none transition-all",
        "focus:ring-2 focus:ring-offset-0",
        error && "ring-2 ring-red-500",
        className,
      )}
      style={{
        background: "var(--bg-tertiary)",
        border: "1px solid var(--border-subtle)",
        color: "var(--text-primary)",
        ...style,
      }}
      {...props}
    />
  )
})

Input.displayName = "Input"
