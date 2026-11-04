import { useState } from "react"
import { LibraryIcon } from "lucide-react"
import { cn } from "cn"

import { useCompany } from "@/features/company/api"

const SIZES = {
  /** Sidebar, page headers: 32 px. */
  sm: "size-8 rounded-lg [&_svg]:size-4",
  /** 40 px. */
  md: "size-10 rounded-lg [&_svg]:size-5",
  /** Login brand panel: 56 px. */
  lg: "size-14 rounded-xl [&_svg]:size-7",
}

/**
 * The company logo (Company Profile page), or the library icon on the main color when there is none or it
 * can't be shown. `tone="sidebar"` uses the sidebar's own main color for the icon tile.
 */
export function BrandMark({
  size = "sm",
  tone = "default",
  src,
  decorative = false,
  className,
}: {
  size?: keyof typeof SIZES
  tone?: "default" | "sidebar"
  /** Shows this picture instead of the saved logo (e.g. the preview of a new one); null shows the icon. */
  src?: string | null
  /** True when the company name is written right next to it (the picture then has empty alt text). */
  decorative?: boolean
  className?: string
}) {
  const company = useCompany()
  const logo = src === undefined ? company.logoUrl : src
  // Remembers which picture failed, so a new one is tried again.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const show = !!logo && logo !== failedSrc

  if (show) {
    return (
      <img
        src={logo}
        alt={decorative ? "" : company.name}
        decoding="async"
        className={cn("shrink-0 object-contain", SIZES[size], className)}
        onError={() => setFailedSrc(logo)}
      />
    )
  }
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center",
        tone === "sidebar" ? "bg-sidebar-primary text-sidebar-primary-foreground" : "bg-primary text-primary-foreground",
        SIZES[size],
        className,
      )}
    >
      <LibraryIcon aria-hidden />
    </div>
  )
}
