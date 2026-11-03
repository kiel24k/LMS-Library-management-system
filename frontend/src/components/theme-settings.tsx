import { CheckIcon, PaletteIcon } from "lucide-react"
import { useId } from "react"
import { cn } from "cn"

import {
  COLOR_PRESETS,
  CUSTOM_COLOR_ID,
  THEME_MODES,
  setCustomColor,
  setThemeColor,
  setThemeMode,
  useTheme,
} from "@/lib/theme"

/** Three big buttons: Light / Dark / Automatic (follow the computer's setting). */
export function ThemeModePicker() {
  const { mode } = useTheme()
  const labelId = useId()
  return (
    <div className="flex flex-col gap-2">
      <p id={labelId} className="text-base font-medium">
        Light or dark
      </p>
      <div role="group" aria-labelledby={labelId} className="grid grid-cols-3 gap-2">
        {THEME_MODES.map(({ value, label, icon: Icon }) => {
          const selected = mode === value
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              onClick={() => setThemeMode(value)}
              className={cn(
                "flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border-2 px-2 py-2 text-base font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                selected
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="size-5" />
              {label}
            </button>
          )
        })}
      </div>
      <p className="text-sm text-muted-foreground">“Automatic” follows the light or dark setting of this computer.</p>
    </div>
  )
}

/** Round color buttons with names, plus "Your own" which opens the computer's color picker. */
export function ThemeColorPicker() {
  const { color, customHex, brand } = useTheme()
  const labelId = useId()
  const customSelected = color === CUSTOM_COLOR_ID

  return (
    <div className="flex flex-col gap-2">
      <p id={labelId} className="text-base font-medium">
        Main color
      </p>
      <div role="group" aria-labelledby={labelId} className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {COLOR_PRESETS.map((preset) => {
          const selected = color === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setThemeColor(preset.id)}
              className={cn(
                "flex min-h-11 flex-col items-center gap-1 rounded-lg px-1 py-2 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50",
                selected && "bg-accent",
              )}
            >
              <Swatch color={preset.swatch} selected={selected} />
              {preset.label}
            </button>
          )
        })}
        {/* A <label> around the native color input: clicking anywhere on it opens the picker. */}
        <label
          className={cn(
            "relative flex min-h-11 cursor-pointer flex-col items-center gap-1 rounded-lg px-1 py-2 text-sm font-medium hover:bg-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
            customSelected && "bg-accent",
          )}
        >
          {/* Show the color the app really uses (same lightness as the buttons), not the raw pick. */}
          <Swatch color={customSelected && brand ? `oklch(0.5 ${brand.c} ${brand.h})` : undefined} selected={customSelected} />
          Your own
          <input
            type="color"
            value={customHex}
            aria-label="Pick your own main color"
            // Clicking selects "Your own" even if the picker is then closed without a change
            // (a color input only fires input/change when the value changes).
            onClick={() => setThemeColor(CUSTOM_COLOR_ID)}
            // onInput fires while dragging in the picker, so the page changes color live.
            onInput={(e) => setCustomColor(e.currentTarget.value)}
            onChange={(e) => setCustomColor(e.currentTarget.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  )
}

function Swatch({ color, selected }: { color?: string; selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-10 items-center justify-center rounded-full ring-offset-2 ring-offset-background",
        selected ? "ring-3 ring-foreground" : "ring-2 ring-foreground/30",
        !color && "bg-[conic-gradient(from_0deg,#ef4444,#f59e0b,#22c55e,#06b6d4,#3b82f6,#a855f7,#ec4899,#ef4444)]",
      )}
      style={color ? { background: color } : undefined}
    >
      {selected ? (
        <CheckIcon className="size-5 text-white drop-shadow-[0_0_2px_rgb(0_0_0/0.8)]" strokeWidth={3} />
      ) : (
        !color && <PaletteIcon className="size-5 text-white drop-shadow-[0_0_2px_rgb(0_0_0/0.8)]" />
      )}
    </span>
  )
}

/** Everything about how the app looks, in one block (used on the Profile settings page). */
export function AppearanceSettings() {
  return (
    <div className="flex flex-col gap-6">
      <ThemeModePicker />
      <ThemeColorPicker />
    </div>
  )
}
