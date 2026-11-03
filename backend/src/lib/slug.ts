export const SLUG_RE = /^[a-z0-9-]{3,60}$/;

/** Turns a library name into a valid slug (lowercase a-z0-9-, 3–60 chars). */
export function slugify(name: string): string {
  let s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  if (!s) s = "library";
  if (s.length < 3) s = `${s}-library`;
  return s;
}

/** `base`, `base-2`, `base-3`, … keeping the result within 60 characters. */
export function slugCandidate(base: string, n: number): string {
  if (n <= 1) return base;
  const suffix = `-${n}`;
  return `${base.slice(0, 60 - suffix.length).replace(/-+$/g, "")}${suffix}`;
}
