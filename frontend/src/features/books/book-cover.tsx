import { useState } from "react"
import { BookIcon } from "lucide-react"
import { cn } from "cn"

const SIZES = {
  /** Books list: about 48 × 64 px. */
  sm: "w-12 rounded-md [&_svg]:size-5",
  /** Book page and the Add / Edit dialog: about 160 × 213 px. */
  lg: "w-40 rounded-lg [&_svg]:size-12",
}

/**
 * A book's picture in a fixed 3:4 box, or a calm book icon in the same box when there is none (or it can't be
 * shown). The picture is decoration: the title is always next to it, so it has no alt text of its own.
 */
export function BookCover({
  src,
  size = "sm",
  className,
}: {
  /** `book.coverUrl`, or a `data:` URL for a picture not saved yet. */
  src: string | null
  size?: keyof typeof SIZES
  className?: string
}) {
  // Remembers which picture failed, so a new one is tried again.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const show = !!src && src !== failedSrc

  return (
    <div
      className={cn(
        "flex aspect-[3/4] shrink-0 items-center justify-center overflow-hidden border bg-muted text-muted-foreground",
        SIZES[size],
        className,
      )}
    >
      {show ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <BookIcon aria-hidden />
      )}
    </div>
  )
}
