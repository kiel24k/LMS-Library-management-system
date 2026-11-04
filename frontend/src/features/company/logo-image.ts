import { NotAPictureError } from "@/features/books/cover-image"
import type { CompanyLogoInput } from "@/types/api"

/** The longest side of the logo after shrinking, in pixels: plenty for the 64 px it is shown at on sharp screens. */
export const LOGO_MAX_SIDE = 512
/** The API refuses logos over 512 KB (decoded). */
export const LOGO_MAX_BYTES = 512 * 1024

// Tried in turn until the picture fits under LOGO_MAX_BYTES.
const SIDES = [LOGO_MAX_SIDE, 384, 256]

export type PreparedLogo = CompanyLogoInput & {
  /** `data:` URL of the same picture, for the preview before it is saved. */
  dataUrl: string
}

/** Opens the file as an image. An <img> also opens SVG logos, which are then saved as a PNG. */
async function decode(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

const base64Bytes = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0)

function encode(canvas: HTMLCanvasElement, mimeType: CompanyLogoInput["mimeType"], quality?: number): PreparedLogo | null {
  const dataUrl = canvas.toDataURL(mimeType, quality)
  // Browsers that can't write the type fall back to PNG; only accept what was asked for.
  const prefix = `data:${mimeType};base64,`
  if (!dataUrl.startsWith(prefix)) return null
  const data = dataUrl.slice(prefix.length)
  return base64Bytes(data) <= LOGO_MAX_BYTES ? { mimeType, data, dataUrl } : null
}

/**
 * Turns a chosen file into a logo for `PUT /company/logo`: at most {@link LOGO_MAX_SIDE} px on its longest side
 * (never made bigger), with see-through parts kept (PNG, or WebP when the PNG is too big). Throws
 * {@link NotAPictureError} when the file is not a picture the browser can open.
 */
export async function prepareLogo(file: File): Promise<PreparedLogo> {
  if (file.type && !file.type.startsWith("image/")) throw new NotAPictureError("This file is not a picture. Please choose a logo picture.")

  let image: HTMLImageElement
  try {
    image = await decode(file)
  } catch {
    throw new NotAPictureError("This picture cannot be opened here. Please choose a PNG, JPG or SVG logo.")
  }
  const naturalWidth = image.naturalWidth || image.width
  const naturalHeight = image.naturalHeight || image.height
  if (!naturalWidth || !naturalHeight) throw new NotAPictureError()

  for (const side of SIDES) {
    const scale = Math.min(1, side / Math.max(naturalWidth, naturalHeight))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(naturalHeight * scale))
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Could not get the picture ready. Please try again.")
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

    const result = encode(canvas, "image/png") ?? encode(canvas, "image/webp", 0.9) ?? encode(canvas, "image/webp", 0.75)
    if (result) return result
  }
  throw new Error("This logo is too detailed to save. Please choose a simpler or smaller picture.")
}
