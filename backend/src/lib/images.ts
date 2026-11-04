/**
 * Validation of uploaded pictures (book covers, the company logo). Pictures are sent as base64 in JSON and kept in
 * the database, so they are checked strictly before they are stored or ever served back.
 */
import { HttpError } from "./http-error.js";

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

/** First bytes each accepted type must start with (null = any byte). */
const MAGIC: Record<ImageMimeType, (number | null)[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  // "RIFF" <4-byte size> "WEBP"
  "image/webp": [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
};

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export const invalidImage = () =>
  new HttpError(400, "INVALID_IMAGE", "This file is not a picture we can use. Please choose a photo (JPEG, PNG or WebP).");

export const isImageMimeType = (v: string): v is ImageMimeType => (IMAGE_MIME_TYPES as readonly string[]).includes(v);

/** "1 MB", "512 KB" — for the IMAGE_TOO_LARGE message. */
const sizeLabel = (bytes: number) => (bytes % (1024 * 1024) === 0 ? `${bytes / (1024 * 1024)} MB` : `${Math.round(bytes / 1024)} KB`);

/**
 * Decodes base64 picture bytes of the stated type. Strict: canonical base64 only (Node's decoder silently skips bad
 * characters), at most `maxBytes` decoded (413 IMAGE_TOO_LARGE, checked before decoding), and the first bytes must
 * match the stated type (400 INVALID_IMAGE otherwise).
 */
export function decodeImage(mimeType: string, base64: string, maxBytes: number): { mimeType: ImageMimeType; data: Buffer } {
  if (!isImageMimeType(mimeType) || !BASE64.test(base64) || base64.length % 4 !== 0) throw invalidImage();
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  if ((base64.length / 4) * 3 - padding > maxBytes) {
    throw new HttpError(
      413,
      "IMAGE_TOO_LARGE",
      `This picture is too big (more than ${sizeLabel(maxBytes)}). Please choose a smaller one.`,
    );
  }
  const data = Buffer.from(base64, "base64");
  if (data.toString("base64") !== base64) throw invalidImage();
  const magic = MAGIC[mimeType];
  if (data.length < magic.length || magic.some((b, i) => b !== null && data[i] !== b)) throw invalidImage();
  return { mimeType, data };
}

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/s;

/** Decodes a `data:image/jpeg|png|webp;base64,…` URL with the rules of `decodeImage`. */
export function decodeImageDataUrl(image: string, maxBytes: number) {
  const m = DATA_URL.exec(image);
  if (!m) throw invalidImage();
  return decodeImage(m[1]!, m[2]!, maxBytes);
}

/**
 * Response headers for picture bytes. A URL with `?v=` (the picture's version) never changes, so it may be cached
 * for good; without it, browsers must revalidate.
 */
export function imageHeaders(mimeType: string, versioned: boolean, scope: "public" | "private") {
  return {
    "Content-Type": mimeType,
    "Cache-Control": versioned ? `${scope}, max-age=31536000, immutable` : "no-cache",
    "X-Content-Type-Options": "nosniff",
  };
}

/** Prisma `Bytes` (Uint8Array) → Buffer without copying. */
export const toBuffer = (data: Uint8Array) => Buffer.from(data.buffer, data.byteOffset, data.byteLength);
