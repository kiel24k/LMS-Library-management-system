/** The longest side of a book picture after shrinking, in pixels (as in the SPEC). */
export const COVER_MAX_SIDE = 800
const JPEG_QUALITY = 0.85

/** Thrown by {@link coverDataUrl} when the chosen file is not a picture the browser can open. */
export class NotAPictureError extends Error {
  constructor(message = "This file is not a picture. Please choose a photo.") {
    super(message)
    this.name = "NotAPictureError"
  }
}

// A real photo this browser cannot open, e.g. an iPhone HEIC photo in Chrome or Edge.
const CANNOT_OPEN = "This photo cannot be opened here. Please choose a JPG or PNG picture."
const isUncommonPhoto = (file: File) =>
  /^image\/(heic|heif|avif|tiff|bmp)/.test(file.type) || /\.(heic|heif|avif|tiff?|bmp)$/i.test(file.name)

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void }

/** Opens the file as an image, turned the right way up (phone photos keep that in their EXIF data). */
async function decode(file: File): Promise<Decoded> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
  } catch {
    // Some browsers can't open every format this way (e.g. Safari and HEIC photos), but an <img> can, and it
    // turns the picture the right way up by itself.
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Turns a chosen file into a JPEG `data:` URL for `PUT /books/:id/cover`: at most {@link COVER_MAX_SIDE} px on its
 * longest side (never made bigger), on white (so a see-through PNG doesn't turn black). Throws
 * {@link NotAPictureError} when the file is not a picture.
 */
export async function coverDataUrl(file: File): Promise<string> {
  // Phones sometimes leave the type empty, so only a stated non-image type is refused before trying.
  if (file.type && !file.type.startsWith("image/")) throw new NotAPictureError()

  let image: Decoded
  try {
    image = await decode(file)
  } catch {
    // A .jpg/.png that will not open is most likely not really a picture; an uncommon photo type just isn't supported.
    throw new NotAPictureError(isUncommonPhoto(file) ? CANNOT_OPEN : undefined)
  }
  try {
    if (!image.width || !image.height) throw new NotAPictureError()
    const scale = Math.min(1, COVER_MAX_SIDE / Math.max(image.width, image.height))
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Could not get the picture ready. Please try again.")
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, width, height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(image.source, 0, 0, width, height)

    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY)
    if (!dataUrl.startsWith("data:image/jpeg")) throw new Error("Could not get the picture ready. Please try again.")
    return dataUrl
  } finally {
    image.close()
  }
}
