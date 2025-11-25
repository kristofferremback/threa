import { clsx } from "clsx"

interface AvatarProps {
  name: string
  size?: "xs" | "sm" | "md" | "lg"
  className?: string
}

const sizeClasses = {
  xs: "w-5 h-5 text-[10px]",
  sm: "w-6 h-6 text-xs",
  md: "w-8 h-8 text-sm",
  lg: "w-10 h-10 text-base",
}

export function Avatar({ name, size = "sm", className }: AvatarProps) {
  const initial = name.charAt(0).toUpperCase()

  return (
    <div
      className={clsx(
        "rounded-full flex items-center justify-center font-medium flex-shrink-0",
        sizeClasses[size],
        className,
      )}
      style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
    >
      {initial}
    </div>
  )
}
