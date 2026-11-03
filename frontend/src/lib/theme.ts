import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { useSyncExternalStore, type ComponentType } from "react"

import { readStorage, writeStorage } from "@/lib/storage"

/**
 * Appearance settings: light / dark / automatic (follow the computer), plus a main color.
 *
 * Saved per browser in localStorage under THEME_STORAGE_KEY. index.html reads the same key before the
 * first paint so the page never flashes the wrong theme — keep its inline script in step with `apply()`.
 *
 * Colors work through two CSS variables on <html>: --brand-h (hue) and --brand-c (chroma), plus a
 * `data-brand` attribute. index.css builds every accent color from those two numbers at a fixed
 * lightness, so text on buttons stays readable whatever color is picked. "Gray" (the default) removes
 * the attribute and the original neutral colors apply.
 */

export const THEME_STORAGE_KEY = "lms-theme"

export type ThemeMode = "light" | "dark" | "system"

export const THEME_MODES: { value: ThemeMode; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "Automatic", icon: MonitorIcon },
]

export type Brand = { h: number; c: number }

export type ColorPreset = { id: string; label: string; brand: Brand | null; swatch: string }

/** Ready-made colors. `swatch` is what the round button shows (close to the light-mode button color). */
export const COLOR_PRESETS: ColorPreset[] = [
  // Gray is mid-gray so it shows on both light and dark backgrounds.
  { id: "gray", label: "Gray", brand: null, swatch: "oklch(0.55 0 0)" },
  { id: "blue", label: "Blue", brand: { h: 255, c: 0.19 }, swatch: "oklch(0.5 0.19 255)" },
  { id: "green", label: "Green", brand: { h: 150, c: 0.15 }, swatch: "oklch(0.5 0.15 150)" },
  { id: "teal", label: "Teal", brand: { h: 190, c: 0.12 }, swatch: "oklch(0.5 0.12 190)" },
  { id: "purple", label: "Purple", brand: { h: 300, c: 0.19 }, swatch: "oklch(0.5 0.19 300)" },
  { id: "pink", label: "Pink", brand: { h: 350, c: 0.19 }, swatch: "oklch(0.5 0.19 350)" },
  // No red: a red main button would look like the red "delete / overdue" warnings.
  { id: "indigo", label: "Indigo", brand: { h: 278, c: 0.18 }, swatch: "oklch(0.5 0.18 278)" },
  { id: "orange", label: "Orange", brand: { h: 50, c: 0.16 }, swatch: "oklch(0.5 0.16 50)" },
]

export const CUSTOM_COLOR_ID = "custom"

export type ThemeState = {
  mode: ThemeMode
  /** A COLOR_PRESETS id, or CUSTOM_COLOR_ID. */
  color: string
  /** The last color picked with the color picker, as #rrggbb. */
  customHex: string
  /** Resolved hue/chroma for `color` (null = gray). Stored so index.html can apply it without the preset table. */
  brand: Brand | null
}

const DEFAULT_STATE: ThemeState = { mode: "system", color: "gray", customHex: "#2563eb", brand: null }

const MAX_CHROMA = 0.2

// ---------------------------------------------------------------------------------------------------
// Color math: #rrggbb → OKLCH (Björn Ottosson's OKLab), used for the custom color picker.

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
}

/** Hue (0–360) and chroma of a #rrggbb color. Chroma is capped so the color stays usable for buttons. */
export function hexToBrand(hex: string): Brand {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = srgbToLinear(((n >> 16) & 255) / 255)
  const g = srgbToLinear(((n >> 8) & 255) / 255)
  const b = srgbToLinear((n & 255) / 255)

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s

  const c = Math.sqrt(A * A + B * B)
  let h = (Math.atan2(B, A) * 180) / Math.PI
  if (h < 0) h += 360
  return { h: Math.round(h * 10) / 10, c: Math.round(Math.min(c, MAX_CHROMA) * 1000) / 1000 }
}

function brandFor(color: string, customHex: string): Brand | null {
  if (color === CUSTOM_COLOR_ID) return hexToBrand(customHex)
  return COLOR_PRESETS.find((p) => p.id === color)?.brand ?? null
}

// ---------------------------------------------------------------------------------------------------
// Store

function load(): ThemeState {
  const raw = readStorage(THEME_STORAGE_KEY)
  if (!raw) return DEFAULT_STATE
  try {
    const parsed = JSON.parse(raw) as Partial<ThemeState> | null
    const mode: ThemeMode =
      parsed?.mode === "light" || parsed?.mode === "dark" || parsed?.mode === "system" ? parsed.mode : DEFAULT_STATE.mode
    const customHex = isHexColor(parsed?.customHex) ? parsed.customHex.toLowerCase() : DEFAULT_STATE.customHex
    const color =
      parsed?.color === CUSTOM_COLOR_ID || COLOR_PRESETS.some((p) => p.id === parsed?.color)
        ? (parsed!.color as string)
        : DEFAULT_STATE.color
    // Always recompute: never trust stored numbers over the preset table / picked color.
    return { mode, color, customHex, brand: brandFor(color, customHex) }
  } catch {
    return DEFAULT_STATE
  }
}

let state: ThemeState = DEFAULT_STATE
const listeners = new Set<() => void>()
let darkQuery: MediaQueryList | null = null

function systemPrefersDark(): boolean {
  return darkQuery?.matches ?? false
}

export function resolvedMode(s: ThemeState = state): "light" | "dark" {
  if (s.mode === "system") return systemPrefersDark() ? "dark" : "light"
  return s.mode
}

function apply() {
  const root = document.documentElement
  const dark = resolvedMode() === "dark"
  root.classList.toggle("dark", dark)
  root.style.colorScheme = dark ? "dark" : "light"
  if (state.brand) {
    root.setAttribute("data-brand", "")
    root.style.setProperty("--brand-h", String(state.brand.h))
    root.style.setProperty("--brand-c", String(state.brand.c))
  } else {
    root.removeAttribute("data-brand")
    root.style.removeProperty("--brand-h")
    root.style.removeProperty("--brand-c")
  }
}

type ThemeSnapshot = ThemeState & { resolved: "light" | "dark" }
// A new object only when something changed, so useSyncExternalStore doesn't loop.
let snapshot: ThemeSnapshot = { ...state, resolved: "light" }

function emit() {
  apply()
  snapshot = { ...state, resolved: resolvedMode() }
  for (const listener of listeners) listener()
}

function save(next: ThemeState) {
  state = next
  writeStorage(THEME_STORAGE_KEY, JSON.stringify(state))
  emit()
}

/** Call once at startup (before rendering). Applies the saved theme and keeps it in sync. */
export function initTheme() {
  try {
    darkQuery = window.matchMedia("(prefers-color-scheme: dark)")
    darkQuery.addEventListener("change", () => {
      if (state.mode === "system") emit()
    })
  } catch {
    darkQuery = null
  }
  // Another tab changed the theme: follow it.
  window.addEventListener("storage", (e) => {
    if (e.key === null || e.key === THEME_STORAGE_KEY) {
      state = load()
      emit()
    }
  })
  state = load()
  apply()
  snapshot = { ...state, resolved: resolvedMode() }
  // Save the cleaned-up settings back (e.g. a color that no longer exists became Gray), so the
  // index.html pre-paint script doesn't briefly show the old color on every reload.
  const raw = readStorage(THEME_STORAGE_KEY)
  if (raw !== null && raw !== JSON.stringify(state)) writeStorage(THEME_STORAGE_KEY, JSON.stringify(state))
}

export function setThemeMode(mode: ThemeMode) {
  save({ ...state, mode })
}

export function setThemeColor(color: string) {
  save({ ...state, color, brand: brandFor(color, state.customHex) })
}

export function setCustomColor(hex: string) {
  if (!isHexColor(hex)) return
  const customHex = hex.toLowerCase()
  save({ ...state, color: CUSTOM_COLOR_ID, customHex, brand: hexToBrand(customHex) })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): ThemeSnapshot {
  return snapshot
}

/** Current appearance settings; re-renders when they (or the computer's light/dark setting) change. */
export function useTheme() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
