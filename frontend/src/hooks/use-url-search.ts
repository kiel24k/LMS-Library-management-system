import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router"

/**
 * A search box bound to the `q` query-string parameter. The input updates
 * immediately; the URL (and therefore the query) follows after a short pause.
 */
export function useUrlSearch(param = "q", delayMs = 300) {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlValue = searchParams.get(param) ?? ""
  const [input, setInput] = useState(urlValue)
  const timer = useRef<number | undefined>(undefined)
  // The function form of setSearchParams sees the params of the render that created it, so the
  // debounced write must use the latest setter or it would undo tab/filter changes made meanwhile.
  const setParamsRef = useRef(setSearchParams)
  useEffect(() => {
    setParamsRef.current = setSearchParams
  }, [setSearchParams])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // Follow the URL when it changes from outside the box (sidebar link, Back/Forward) — unless the
  // user is mid-typing, in which case their pending text wins.
  useEffect(() => {
    if (timer.current !== undefined) return
    setInput((current) => (current.trim() === urlValue.trim() ? current : urlValue))
  }, [urlValue])

  const onChange = useCallback(
    (value: string) => {
      setInput(value)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        timer.current = undefined
        setParamsRef.current(
          (prev) => {
            const next = new URLSearchParams(prev)
            if (value.trim()) next.set(param, value)
            else next.delete(param)
            next.delete("page")
            return next
          },
          { replace: true },
        )
      }, delayMs)
    },
    [param, delayMs],
  )

  return { input, onChange, value: urlValue }
}

/** Read/write helpers for simple query-string state (page, tabs, filters). */
export function useUrlParam(name: string) {
  const [searchParams, setSearchParams] = useSearchParams()
  const value = searchParams.get(name)
  const set = useCallback(
    (v: string | null, opts: { resetPage?: boolean } = { resetPage: true }) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (v === null || v === "") next.delete(name)
          else next.set(name, v)
          if (opts.resetPage && name !== "page") next.delete("page")
          return next
        },
        { replace: name !== "tab" },
      )
    },
    [name, setSearchParams],
  )
  return [value, set] as const
}

export function usePageParam(): [number, (page: number) => void] {
  const [raw, set] = useUrlParam("page")
  const n = Number(raw)
  const page = Number.isInteger(n) && n >= 1 ? n : 1
  return [page, (p: number) => set(p <= 1 ? null : String(p), { resetPage: false })]
}
